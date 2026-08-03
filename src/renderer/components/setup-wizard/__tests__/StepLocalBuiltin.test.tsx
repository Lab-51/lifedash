// @vitest-environment jsdom
// LOCAL-RT.1 Task 5 — the wizard's built-in-AI step. Covers the four things this
// screen can get dangerously wrong: (1) doing anything at all before the user
// clicks, (2) hiding that a small machine's only tool-calling model is Chinese-
// origin, (3) offering a model that is not on disk (and therefore not routable),
// and (4) inventing its own hedged copy instead of the single source in format.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NO_TOOL_CALLING_CONSEQUENCE, bestMatchRationale } from '../../settings/local-ai/format';
import { IDLE_RUNTIME, IDLE_SNAPSHOT, makeView, runtimeIdOf } from './localModelsFixture';

const getLocalModelsView = vi.fn();
const downloadLocalModel = vi.fn().mockResolvedValue({});
const pauseLocalModelDownload = vi.fn().mockResolvedValue(true);
const cancelLocalModelDownload = vi.fn().mockResolvedValue(true);
const deleteLocalModel = vi.fn().mockResolvedValue({ freedBytes: 1 });
const checkBuiltinRuntime = vi.fn();
const stopBuiltinRuntime = vi.fn();
const getRuntimeSnapshot = vi.fn();
const onRuntimeStatus = vi.fn(() => () => {});
const getSetting = vi.fn().mockResolvedValue(null);
const setSetting = vi.fn().mockResolvedValue(undefined);
const onLocalModelProgress = vi.fn(() => () => {});

vi.stubGlobal('electronAPI', {
  getLocalModelsView,
  downloadLocalModel,
  pauseLocalModelDownload,
  cancelLocalModelDownload,
  deleteLocalModel,
  checkBuiltinRuntime,
  stopBuiltinRuntime,
  getRuntimeSnapshot,
  onRuntimeStatus,
  getSetting,
  setSetting,
  onLocalModelProgress,
});

const { default: StepLocalBuiltin } = await import('../StepLocalBuiltin');

const props = () => ({
  onFinish: vi.fn(),
  onUseCloud: vi.fn(),
  onBack: vi.fn(),
  onSkip: vi.fn(),
});

/** Open a HudSelect by its accessible name and click one of its options. */
async function pickFromSelect(selectLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: selectLabel }));
  fireEvent.click(await screen.findByRole('button', { name: optionLabel }));
}

const finishButton = () => screen.getByRole('button', { name: /Use this model/ });

beforeEach(() => {
  vi.clearAllMocks();
  getLocalModelsView.mockResolvedValue(makeView());
  checkBuiltinRuntime.mockResolvedValue(IDLE_RUNTIME);
  getRuntimeSnapshot.mockResolvedValue(IDLE_SNAPSHOT);
  getSetting.mockResolvedValue(null);
});

describe('StepLocalBuiltin — hardware summary and shortlist', () => {
  it('states what the machine reports and shortlists the models that fit it', async () => {
    render(<StepLocalBuiltin {...props()} />);

    expect(await screen.findByText(/Your machine reports 32 GB of memory/)).toBeInTheDocument();
    // A shortlist, not the whole catalogue — the rest is one visible click away.
    expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('button'))).toHaveLength(4);
    expect(screen.getByRole('button', { name: /Show all 8 models/ })).toBeInTheDocument();
  });

  it('reuses the single hedged best-match rationale rather than restating it', async () => {
    const view = makeView();
    render(<StepLocalBuiltin {...props()} />);

    // Byte-identical to format.ts — divergent hedging is what turns an honest
    // claim into a misleading one. (Rendered on the recommended chat model and the
    // recommended embedding model, exactly as Settings → Local AI does.)
    const rendered = await screen.findAllByText(bestMatchRationale(view.tier));
    expect(rendered.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Likely best for your machine').length).toBeGreaterThan(0);
  });

  it('expands to the full fitting list on request', async () => {
    render(<StepLocalBuiltin {...props()} />);

    fireEvent.click(await screen.findByRole('button', { name: /Show all 8 models/ }));

    expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('button'))).toHaveLength(9);
    expect(screen.getByRole('button', { name: /Show fewer/ })).toBeInTheDocument();
  });
});

describe('StepLocalBuiltin — optional by construction', () => {
  it('rendering reads the catalogue and nothing else: no spawn, no transfer, no writes', async () => {
    render(<StepLocalBuiltin {...props()} />);
    await screen.findByText(/Your machine reports/);

    expect(getLocalModelsView).toHaveBeenCalledWith(false);
    // getRuntimeSnapshot (LocalRuntimeCard's shared hook) is a pure read that never spawns.
    expect(getRuntimeSnapshot).toHaveBeenCalled();
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(deleteLocalModel).not.toHaveBeenCalled();
    expect(stopBuiltinRuntime).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('skipping and going back leave zero downloads and zero writes behind', async () => {
    const p = props();
    render(<StepLocalBuiltin {...p} />);
    await screen.findByText(/Your machine reports/);

    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(p.onSkip).toHaveBeenCalledTimes(1);
    expect(p.onBack).toHaveBeenCalledTimes(1);
    expect(p.onFinish).not.toHaveBeenCalled();
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('StepLocalBuiltin — the low-RAM / non-Chinese / tool-calling collision', () => {
  beforeEach(() => getLocalModelsView.mockResolvedValue(makeView({ totalRamGB: 8 })));

  it('recommends the small tool-caller by default on an 8 GB machine', async () => {
    render(<StepLocalBuiltin {...props()} />);

    const row = (await screen.findByText('Qwen3 4B (Q4_K_M)')).closest('li') as HTMLElement;
    expect(within(row).getByText('Likely best for your machine')).toBeInTheDocument();
    expect(within(row).getByText('Tool calling')).toBeInTheDocument();
    expect(screen.queryByText(/None of the models shown can call tools/)).not.toBeInTheDocument();
  });

  it('names the excluded Chinese-origin model and offers cloud when origin policy rules it out', async () => {
    const p = props();
    render(<StepLocalBuiltin {...p} />);
    await screen.findByText('Qwen3 4B (Q4_K_M)');

    fireEvent.click(screen.getByRole('button', { name: 'Filter models by country of origin' }));
    fireEvent.click(await screen.findByRole('button', { name: 'United States' }));

    const steer = (await screen.findByText(/None of the models shown can call tools/)).closest('div') as HTMLElement;
    expect(steer).toHaveTextContent('Qwen3 4B (Q4_K_M) — China');
    expect(steer).toHaveTextContent('excluded by your current filters');
    // Option (a): a model that chats but cannot act — stated in format.ts's words.
    expect(steer).toHaveTextContent(NO_TOOL_CALLING_CONSEQUENCE);
    // Option (b): cloud, as a real route out and not just a mention.
    fireEvent.click(screen.getByRole('button', { name: /Use a cloud provider instead/ }));
    expect(p.onUseCloud).toHaveBeenCalledTimes(1);
    // The remaining model is still offered — the user is informed, not blocked.
    expect(screen.getByRole('button', { name: /Download Gemma 3 4B/ })).toBeEnabled();
  });
});

describe('StepLocalBuiltin — the pick is explicit, and only a downloaded model is routable', () => {
  it('starts a transfer only on an explicit click, and records that click as the pick', async () => {
    render(<StepLocalBuiltin {...props()} />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');
    expect(finishButton()).toBeDisabled();

    getLocalModelsView.mockResolvedValue(makeView({ downloaded: ['qwen3-14b'] }));
    fireEvent.click(screen.getByRole('button', { name: /Download Qwen3 14B/ }));

    await waitFor(() => expect(downloadLocalModel).toHaveBeenCalledWith({ modelId: 'qwen3-14b', quant: 'Q4_K_M' }));
    await waitFor(() => expect(finishButton()).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Model to use for the in-meeting assistant' })).toHaveTextContent(
      'Qwen3 14B (Q4_K_M) — tool calling',
    );
  });

  it('keeps finishing blocked while the file has not landed', async () => {
    render(<StepLocalBuiltin {...props()} />);
    await screen.findByText('Qwen3 14B (Q4_K_M)');

    fireEvent.click(screen.getByRole('button', { name: /Download Qwen3 14B/ }));

    await waitFor(() => expect(downloadLocalModel).toHaveBeenCalled());
    expect(finishButton()).toBeDisabled();
    expect(screen.getByText(/Download one above to choose it here/)).toBeInTheDocument();
  });

  it('lets an already-downloaded model be chosen — arriving with one is not a dead end', async () => {
    const p = props();
    getLocalModelsView.mockResolvedValue(makeView({ totalRamGB: 8, downloaded: ['qwen3-4b', 'embeddinggemma-300m'] }));
    render(<StepLocalBuiltin {...p} />);

    // Downloaded rows offer Delete, not Download, so the picker is the only route.
    await screen.findByRole('button', { name: /Delete Qwen3 4B/ });
    expect(finishButton()).toBeDisabled();

    await pickFromSelect('Model to use for the in-meeting assistant', 'Qwen3 4B (Q4_K_M) — tool calling');
    fireEvent.click(finishButton());

    expect(p.onFinish).toHaveBeenCalledWith({
      chatModelId: runtimeIdOf('qwen3-4b'),
      embeddingModelId: runtimeIdOf('embeddinggemma-300m'),
    });
  });

  it('hands up no embedding id when no embedding model was downloaded', async () => {
    const p = props();
    getLocalModelsView.mockResolvedValue(makeView({ totalRamGB: 8, downloaded: ['qwen3-4b'] }));
    render(<StepLocalBuiltin {...p} />);

    await screen.findByText(/No embedding model downloaded/);
    await pickFromSelect('Model to use for the in-meeting assistant', 'Qwen3 4B (Q4_K_M) — tool calling');
    fireEvent.click(finishButton());

    expect(p.onFinish).toHaveBeenCalledWith({ chatModelId: runtimeIdOf('qwen3-4b'), embeddingModelId: undefined });
  });

  it('spells out the consequence when the chosen model cannot call tools', async () => {
    getLocalModelsView.mockResolvedValue(makeView({ totalRamGB: 8, downloaded: ['gemma-3-4b-it'] }));
    render(<StepLocalBuiltin {...props()} />);

    await screen.findByRole('button', { name: /Delete Gemma 3 4B/ });
    expect(screen.getAllByText(NO_TOOL_CALLING_CONSEQUENCE)).toHaveLength(1); // row advisory only

    await pickFromSelect('Model to use for the in-meeting assistant', 'Gemma 3 4B Instruct (Q4_K_M) — no tool calling');

    // Restated under the picker — same single source, so it can never diverge.
    expect(screen.getAllByText(NO_TOOL_CALLING_CONSEQUENCE)).toHaveLength(2);
  });
});

describe('StepLocalBuiltin — failure handling', () => {
  it('surfaces a catalogue read failure instead of rendering an empty screen', async () => {
    getLocalModelsView.mockRejectedValue(new Error('catalog unreadable'));
    render(<StepLocalBuiltin {...props()} />);

    expect(await screen.findByText('catalog unreadable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skip for now/ })).toBeInTheDocument();
  });

  it('surfaces a failed download without losing the shortlist', async () => {
    downloadLocalModel.mockRejectedValueOnce(new Error('Disk is full'));
    render(<StepLocalBuiltin {...props()} />);

    fireEvent.click(await screen.findByRole('button', { name: /Download Qwen3 14B/ }));

    expect(await screen.findByText('Disk is full')).toBeInTheDocument();
    expect(screen.getByText('Qwen3 14B (Q4_K_M)')).toBeInTheDocument();
  });
});
