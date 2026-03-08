# LifeDash Demo Video — Storyboard

**Target length:** 60-75 seconds
**Format:** Screen recording (OBS or ScreenToGif), no voiceover, text overlays only
**Distribution:** Reddit, Twitter/X, GitHub README — must work as silent autoplay or GIF
**Resolution:** 1920x1080 (record at native, export at 1080p and 720p GIF)

---

## Pre-Recording Setup

- Close all other apps. Only LifeDash should be visible.
- Use a clean state: one or two existing project cards on the Kanban board so it
  does not look empty, but keep it minimal.
- Have a pre-recorded meeting audio clip ready (2-3 minutes of realistic
  conversation, e.g., a product standup). This lets you fast-forward through the
  recording/transcription step without waiting in real time.
- Set font size to Default or Large so text is readable at 720p.
- Dark desktop wallpaper — the app's dark HUD theme should be the visual focus.

---

## Scene Breakdown

### SCENE 1 — Hook (0:00 - 0:05)

**On screen:**
Fade in to a black screen with a single line of bold white text, centered.

**Text overlay:**
"Your meetings are being uploaded to someone else's server."

**At 0:03**, hard cut to:
"What if they didn't have to be?"

**Transition:** Hard cut to Scene 2.

**Notes:** This is the entire pitch in five seconds. The privacy angle is the
hook. No app shown yet — pure text on black. Keep the font clean and large
(minimum 48px equivalent).

---

### SCENE 2 — App Reveal + Start Recording (0:05 - 0:15)

**On screen:**
LifeDash dashboard, full window. The dark HUD UI should fill the frame. Mouse
moves to the meeting recorder widget/panel and clicks "Start Recording."

The recording indicator activates — the waveform or timer becomes visible,
showing audio is being captured.

**Text overlay (bottom center, semi-transparent bar):**
"LifeDash records your meetings locally. Nothing leaves your machine."

**At 0:12**, show the recording running for a moment (waveform active, timer
counting up) to establish that capture is happening.

**Transition:** Quick fade (0.3s) to Scene 3.

**Notes:** Move the mouse deliberately and smoothly — no frantic clicking. Let
the viewer's eye follow the cursor to the record button. The UI itself is
visually striking; give it a beat to land.

---

### SCENE 3 — Transcription (0:15 - 0:25)

**On screen:**
Stop the recording. The transcription process begins — show the Whisper
progress indicator or loading state. Then cut to (or fast-forward to) the
completed transcript appearing on screen.

Scroll slowly through a few lines of the transcript so the viewer can see it
is real, readable text with speaker turns.

**Text overlay:**
"Transcribed on-device with Whisper. No cloud. No third party."

**Transition:** Quick fade to Scene 4.

**Notes:** If real-time transcription takes too long, record this segment
separately with a pre-completed transcript and splice. The key is showing
the progression: recording stops -> processing -> transcript appears.
Keep the scroll slow enough to read 2-3 lines.

---

### SCENE 4 — AI Meeting Brief (0:25 - 0:38)

**On screen:**
Click the "Generate Brief" button (or equivalent action). Show the AI
processing indicator briefly, then the meeting brief/summary appearing.

The brief should include visible sections: a summary paragraph, key decisions,
and action items. Slowly scroll through the brief so each section heading is
readable.

**Text overlay:**
"AI generates a structured brief — summary, decisions, action items."

**At 0:35**, pause the scroll on the action items section. Let it sit for
2 seconds so the viewer registers the extracted items.

**Transition:** Quick fade to Scene 5.

**Notes:** This is the "wow" moment. The raw transcript has been turned into a
structured, actionable document. Make sure the brief content looks realistic
and professional — not placeholder text. If using a real meeting recording,
the output will be genuine.

---

### SCENE 5 — Push to Kanban (0:38 - 0:50)

**On screen:**
From the action items in the brief, click the button/action to push items to
the Kanban board. Show the items appearing as cards on the board.

Then briefly interact with the Kanban — drag one card from one column to
another (e.g., "To Do" to "In Progress") to show it is a real, functional
board.

**Text overlay:**
"Action items become tasks on your board. One click."

**Transition:** Quick fade to Scene 6.

**Notes:** The record-to-board pipeline is now complete. This scene closes the
core workflow loop. The drag interaction proves the board is functional, not
just a static view. Keep the drag motion smooth and deliberate.

---

### SCENE 6 — Feature Montage (0:50 - 0:58)

**On screen:**
Quick cuts (2-3 seconds each) showing secondary features:

1. **AI Brainstorming** — show the chat interface with a prompt and AI response
   flowing in. (2s)
2. **Focus Timer** — show the timer running with a task name visible. (2s)
3. **Idea Repository** — show the ideas panel with a few saved entries. (2s)

**Text overlay (persistent across all three cuts):**
"Plus: AI brainstorming, focus timer, idea capture."

**Transition:** Fade to black over 0.5s into Scene 7.

**Notes:** These cuts are fast — the goal is to communicate "there's more here"
without slowing the video down. Each feature gets just enough screen time to
be recognized, not understood in depth. If the video is running long, cut this
scene to two features or drop it entirely.

---

### SCENE 7 — Closing / CTA (0:58 - 1:10)

**On screen:**
Black background. Text appears line by line with 1-second spacing:

Line 1: "100% local. 100% private."
Line 2: "Free and open source. Bring your own API key."
Line 3 (slightly larger, bold): "LifeDash"
Line 4 (smaller, different color — e.g., the app's accent blue):
"github.com/Lab-51/lifedash"

Hold the final frame for 3 seconds.

**Transition:** None — this is the end card. Holds until video ends.

**Notes:** No music fade-out needed since there is no audio track assumed. If
you add background music later, fade it out over the last 3 seconds. The
GitHub URL is the CTA — keep it clean and prominent. Do not clutter with
multiple links or social handles.

---

## Production Notes

### Text Overlay Style
- Font: Inter, SF Pro, or any clean sans-serif
- Color: White text on semi-transparent dark bar (#000000 at 60% opacity)
- Position: Bottom center, with ~40px padding from screen edge
- Size: 24-28px for body text, 48px+ for hook text (Scenes 1 and 7)
- All caps for Scene 1 hook text; sentence case for everything else

### Pacing
- The core workflow (Scenes 2-5) should feel like one continuous flow, not
  disconnected features. Minimize dead time between actions.
- Mouse movements should be smooth and intentional. If using ScreenToGif,
  record at a comfortable pace and speed up 1.5x in post if needed.
- Each text overlay should appear for at least 3 seconds — enough to read
  at normal speed.

### If Converting to GIF
- Target file size: under 15 MB for GitHub README, under 8 MB for Twitter
- Drop the frame rate to 15fps for GIF export
- Consider a shorter cut (Scenes 1-5 only, ~50 seconds) for GIF — drop the
  feature montage and simplify the CTA to a 2-second end card
- Use ScreenToGif's built-in optimizer or gifski for better compression

### Recording Checklist
- [ ] Desktop is clean (no notifications, no taskbar popups)
- [ ] LifeDash is the only visible window
- [ ] App state is prepared (Kanban has 1-2 existing cards)
- [ ] Meeting audio clip is ready for the recording demo
- [ ] Screen recording tool is set to capture LifeDash window only (not full screen)
- [ ] Text overlay tool is ready (ScreenToGif editor, or DaVinci Resolve for OBS recordings)
- [ ] Test one full run-through before the real recording

### Alternate Short Version (30 seconds, for Twitter/GIF)

If a shorter cut is needed:

| Time      | Content                                      |
|-----------|----------------------------------------------|
| 0:00-0:03 | Hook text: "Meetings. Transcribed. Private." |
| 0:03-0:10 | Start recording, show waveform               |
| 0:10-0:15 | Transcript appears                           |
| 0:15-0:22 | AI brief with action items                   |
| 0:22-0:27 | Push to Kanban board                         |
| 0:27-0:30 | End card: "LifeDash — github.com/Lab-51/lifedash" |
