import { describe, it, expect } from 'vitest';
import {
  aiProviderNameSchema,
  createAIProviderInputSchema,
  updateAIProviderInputSchema,
  idParamSchema,
} from '../../../shared/validation/schemas';
import { validateInput } from '../../../shared/validation/ipc-validator';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

// ============================================================================
// aiProviderNameSchema
// ============================================================================

describe('aiProviderNameSchema', () => {
  it.each(['openai', 'anthropic', 'ollama', 'kimi'])('accepts valid provider "%s"', (name) => {
    expect(aiProviderNameSchema.safeParse(name).success).toBe(true);
  });

  it('rejects unknown provider name', () => {
    expect(aiProviderNameSchema.safeParse('gemini').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(aiProviderNameSchema.safeParse('').success).toBe(false);
  });

  it('rejects numeric input', () => {
    expect(aiProviderNameSchema.safeParse(42).success).toBe(false);
  });

  it('is case-sensitive (rejects "OpenAI")', () => {
    expect(aiProviderNameSchema.safeParse('OpenAI').success).toBe(false);
  });
});

// ============================================================================
// createAIProviderInputSchema
// ============================================================================

describe('createAIProviderInputSchema', () => {
  it('accepts valid input with name only', () => {
    const result = createAIProviderInputSchema.safeParse({ name: 'openai' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('openai');
      expect(result.data.apiKey).toBeUndefined();
      expect(result.data.displayName).toBeUndefined();
      expect(result.data.baseUrl).toBeUndefined();
    }
  });

  it('accepts valid input with all optional fields', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'anthropic',
      displayName: 'Claude Provider',
      apiKey: 'sk-ant-api03-test-key-here',
      baseUrl: 'https://api.anthropic.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('Claude Provider');
      expect(result.data.apiKey).toBe('sk-ant-api03-test-key-here');
    }
  });

  it('accepts ollama without API key (local provider)', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'ollama',
      baseUrl: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = createAIProviderInputSchema.safeParse({
      apiKey: 'sk-test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider name', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'gemini',
      apiKey: 'sk-test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects displayName over 200 characters', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'openai',
      displayName: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects apiKey over 500 characters', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'openai',
      apiKey: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects baseUrl over 500 characters', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'openai',
      baseUrl: 'https://' + 'x'.repeat(500),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// updateAIProviderInputSchema
// ============================================================================

describe('updateAIProviderInputSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateAIProviderInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with displayName only', () => {
    const result = updateAIProviderInputSchema.safeParse({
      displayName: 'My GPT Provider',
    });
    expect(result.success).toBe(true);
  });

  it('accepts enabling/disabling a provider', () => {
    const result = updateAIProviderInputSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it('accepts updating API key', () => {
    const result = updateAIProviderInputSchema.safeParse({
      apiKey: 'sk-new-key-12345',
    });
    expect(result.success).toBe(true);
  });

  it('accepts updating baseUrl', () => {
    const result = updateAIProviderInputSchema.safeParse({
      baseUrl: 'https://custom-proxy.example.com/v1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects displayName over 200 characters', () => {
    const result = updateAIProviderInputSchema.safeParse({
      displayName: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    const result = updateAIProviderInputSchema.safeParse({ enabled: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects apiKey over 500 characters', () => {
    const result = updateAIProviderInputSchema.safeParse({
      apiKey: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Schema ensures API key data does not appear in parsed output shapes
// ============================================================================

describe('API key safety at schema level', () => {
  it('createAIProviderInputSchema does not add extra fields', () => {
    const result = createAIProviderInputSchema.safeParse({
      name: 'openai',
      apiKey: 'sk-secret-key',
      extraField: 'should-be-stripped',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Zod strips unknown fields by default — verify no leakage
      expect('extraField' in result.data).toBe(false);
    }
  });

  it('updateAIProviderInputSchema strips unknown fields', () => {
    const result = updateAIProviderInputSchema.safeParse({
      enabled: true,
      apiKeyEncrypted: 'leaked-encrypted-key',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('apiKeyEncrypted' in result.data).toBe(false);
    }
  });
});

// ============================================================================
// validateInput with AI provider schemas
// ============================================================================

describe('validateInput with AI provider schemas', () => {
  it('returns parsed data for valid create input', () => {
    const data = { name: 'anthropic', apiKey: 'sk-test' };
    const result = validateInput(createAIProviderInputSchema, data);
    expect(result.name).toBe('anthropic');
  });

  it('throws with "Validation failed:" prefix on invalid input', () => {
    expect(() => validateInput(createAIProviderInputSchema, { name: 'invalid-provider' })).toThrow(
      /^Validation failed:/,
    );
  });

  it('throws with field path for nested validation error', () => {
    expect(() => validateInput(createAIProviderInputSchema, { name: 123 })).toThrow(/name/);
  });

  it('validates idParamSchema for provider delete', () => {
    expect(validateInput(idParamSchema, VALID_UUID)).toBe(VALID_UUID);
  });

  it('throws for non-UUID provider id', () => {
    expect(() => validateInput(idParamSchema, 'provider-abc')).toThrow();
  });

  it('validates multiple update fields simultaneously', () => {
    const data = {
      displayName: 'Updated Name',
      enabled: true,
      baseUrl: 'https://new-url.com',
    };
    const result = validateInput(updateAIProviderInputSchema, data);
    expect(result.displayName).toBe('Updated Name');
    expect(result.enabled).toBe(true);
    expect(result.baseUrl).toBe('https://new-url.com');
  });
});
