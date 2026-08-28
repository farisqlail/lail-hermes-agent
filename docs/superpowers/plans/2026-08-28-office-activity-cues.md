# Office Activity Cues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 3D office avatars visibly show *what* an employee is doing, not just *where* they stand — a chat speech bubble while their reply is streaming/speaking, a pulsing screen glow while anyone is working, and a presenting pose for whoever is at the whiteboard POI.

**Architecture:** Three small, independent additions layered on the existing `OfficeCanvas.tsx` avatar/animation system — no new rendering pipeline, no new geometry system, no backend changes. A new `speakingEmployeeId` prop is lifted from `OfficeSessionChat`'s existing `streaming`/`speaking` state, through `Office.tsx`, into `OfficeCanvas`. The screen-glow pulse and presenter pose both reuse data already tracked per-avatar (`zoneStatus`, `assignedPoi`).

**Tech Stack:** React, TypeScript, Three.js (raw, no R3F). No new dependencies.

**Spec:** No separate spec file — this is a bounded change (extends an existing flow) per the `superpowers:brainstorming` bounded path, which skips the spec document. The design was agreed in chat: see the conversation immediately preceding this plan for the full brainstorming record (data-source decision: status-only, no backend changes; chat-cue decision: small prop-lift, not a new store).

## Global Constraints

- No new npm dependencies.
- No backend/API changes — `Employee.status` (`idle | working | on_break | in_meeting`) stays the only status signal.
- No GLTF/skinned-mesh work — stay within the existing procedural box-avatar + canvas-sprite style already used for `nameSprite`/`haloRing`/`auraRing`.
- `npm run typecheck` (from `web/`) must pass after every task.

---

### Task 1: Lift chat-active state out of `OfficeSessionChat`

**Files:**
- Modify: `web/src/components/OfficeSessionChat.tsx:26-31` (props interface), `:62` (component signature), `:108` (after employee derivation)

**Interfaces:**
- Consumes: existing `streaming` (bool, line 99), `speaking` (bool, line 94), `employee` (`Employee | null`, derived line 108) component state — no changes to these.
- Produces: new prop `onStreamingChange?: (employeeId: string | null) => void`, called with the active employee's `employee_id` whenever `streaming || speaking` is true and with `null` when neither is true or the component unmounts. Task 2 consumes this exact signature.

- [ ] **Step 1: Add the prop to the interface**

In `web/src/components/OfficeSessionChat.tsx`, modify the `OfficeSessionChatProps` interface (currently lines 26-31):

```tsx
interface OfficeSessionChatProps {
  sessionId: string;
  employees: Employee[];
  onBack: () => void;
  onDeleted: () => void;
  onStreamingChange?: (employeeId: string | null) => void;
}
```

- [ ] **Step 2: Destructure the new prop**

Modify the component signature (currently line 62):

```tsx
export function OfficeSessionChat({ sessionId, employees, onBack, onDeleted, onStreamingChange }: OfficeSessionChatProps) {
```

- [ ] **Step 3: Report active/inactive state**

Immediately after the existing `employee`/`employeeName` derivation (currently lines 108-109):

```tsx
  const employee = employees.find((e) => e.employee_id === session?.employee_id) || null;
  const employeeName = employee?.name || 'Employee';

  const activeSpeakerId = (streaming || speaking) && employee ? employee.employee_id : null;

  useEffect(() => {
    onStreamingChange?.(activeSpeakerId);
  }, [activeSpeakerId, onStreamingChange]);

  useEffect(() => {
    return () => { onStreamingChange?.(null); };
    // Clears the cue when this pane closes (e.g. the office chat modal is
    // dismissed), independent of whatever streaming/speaking was mid-flight.
  }, [onStreamingChange]);
```

- [ ] **Step 4: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/OfficeSessionChat.tsx
git commit -m "feat(office): report active chat speaker via onStreamingChange"
```

---

### Task 2: Wire `speakingEmployeeId` through `Office.tsx`

**Files:**
- Modify: `web/src/views/Office.tsx:36-56` (component state), `:221-224` (`OfficeCanvas` usage), `:350-355` (`OfficeSessionChat` usage)

**Interfaces:**
- Consumes: `onStreamingChange` prop from Task 1 (exact signature `(employeeId: string | null) => void`).
- Produces: `speakingEmployeeId: string | null` passed as a new prop to `OfficeCanvas`. Task 3 consumes this exact prop name/type.

- [ ] **Step 1: Add state and import `useCallback`**

`web/src/views/Office.tsx` line 1 currently reads:

```tsx
import React, { useEffect, useState } from 'react';
```

Change to:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
```

Then, alongside the existing `feedKey` state (currently line 56), add:

```tsx
  const [feedKey, setFeedKey] = useState(0);
  const [speakingEmployeeId, setSpeakingEmployeeId] = useState<string | null>(null);
  const handleStreamingChange = useCallback((id: string | null) => setSpeakingEmployeeId(id), []);
```

- [ ] **Step 2: Pass the id into `OfficeCanvas`**

Currently (lines 220-225):

```tsx
      <div style={{ marginBottom: '24px' }}>
        <OfficeCanvas
          employees={employees}
          onSelectEmployee={openChatFor}
        />
      </div>
```

Change to:

```tsx
      <div style={{ marginBottom: '24px' }}>
        <OfficeCanvas
          employees={employees}
          onSelectEmployee={openChatFor}
          speakingEmployeeId={speakingEmployeeId}
        />
      </div>
```

- [ ] **Step 3: Pass the callback into `OfficeSessionChat`**

Currently (lines 349-356):

```tsx
            <div style={{ flex: 1, minHeight: 0, padding: 'var(--s4)', display: 'flex' }}>
              <OfficeSessionChat
                sessionId={officeSessionId}
                employees={employees}
                onBack={() => navigate('#/office')}
                onDeleted={() => navigate('#/office')}
              />
            </div>
```

Change to:

```tsx
            <div style={{ flex: 1, minHeight: 0, padding: 'var(--s4)', display: 'flex' }}>
              <OfficeSessionChat
                sessionId={officeSessionId}
                employees={employees}
                onBack={() => navigate('#/office')}
                onDeleted={() => navigate('#/office')}
                onStreamingChange={handleStreamingChange}
              />
            </div>
```

- [ ] **Step 4: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: errors about `OfficeCanvas` not accepting `speakingEmployeeId` yet — that's Task 3. Confirm no *other* new errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Office.tsx
git commit -m "feat(office): track which employee's chat is actively speaking"
```

---

### Task 3: Speech-bubble sprite on the active speaker's avatar

**Files:**
- Modify: `web/src/components/OfficeCanvas.tsx:19-23` (props interface), `:202-224` (`AvatarMeshGroup` interface), `:226` (component signature), after `:200` (new sprite factory, next to `createNameSprite`), `:1059-1063` area (avatar spawn), `:1093-1116` area (`av` object literal), after `:1131` (new visibility effect), inside the animate loop's per-avatar block (`:905-909` area, next to the `auraRing` pulse)

**Interfaces:**
- Consumes: `speakingEmployeeId` prop from Task 2 (`string | null`).
- Produces: nothing consumed by later tasks — self-contained.

- [ ] **Step 1: Accept the new prop**

`OfficeCanvasProps` (currently lines 19-23):

```tsx
interface OfficeCanvasProps {
  employees: Employee[];
  onSelectEmployee?: (employee: Employee) => void;
  selectedEmployeeId?: string | null;
  speakingEmployeeId?: string | null;
}
```

Component signature (currently line 226):

```tsx
export function OfficeCanvas({ employees, onSelectEmployee, selectedEmployeeId, speakingEmployeeId }: OfficeCanvasProps) {
```

- [ ] **Step 2: Add a speech-bubble sprite factory**

Add this function right after `createNameSprite` (which ends at line 200), following the same canvas-texture pattern:

```tsx
function createSpeechBubbleSprite(): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 40, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, 44);
  ctx.lineTo(10, 58);
  ctx.lineTo(28, 44);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(20 + i * 12, 24, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}
```

- [ ] **Step 3: Track it on `AvatarMeshGroup`**

`AvatarMeshGroup` (currently lines 202-224) — add one field next to `nameSprite`:

```tsx
  nameSprite: THREE.Sprite;
  speechBubble: THREE.Sprite;
```

- [ ] **Step 4: Create and attach it when an avatar spawns**

In the avatar-spawn block, right after the existing name sprite is added to the group (currently lines 1059-1063):

```tsx
        // Overhead Name Sprite
        const nameSprite = createNameSprite(emp.name, emp.role);
        nameSprite.position.set(0, 2.35, 0);
        group.add(nameSprite);

        // Chat-active speech bubble (hidden by default, toggled in the
        // speakingEmployeeId effect below)
        const speechBubble = createSpeechBubbleSprite();
        speechBubble.position.set(0, 2.75, 0);
        speechBubble.visible = false;
        group.add(speechBubble);
```

Add `speechBubble,` into the `av = { ... }` object literal (currently lines 1093-1116), next to `nameSprite,`:

```tsx
          nameSprite,
          speechBubble,
```

- [ ] **Step 5: Dispose it when an avatar despawns**

The despawn block (currently lines 947-961) disposes `nameSprite`'s material/texture explicitly (meshes are handled by the `traverse` above it, but `Sprite` isn't a `Mesh` so it's handled separately). Add the same treatment for `speechBubble` right after the existing `nameSprite` disposal:

```tsx
        av.nameSprite.material.map?.dispose();
        av.nameSprite.material.dispose();
        av.speechBubble.material.map?.dispose();
        av.speechBubble.material.dispose();
        currentMap.delete(id);
```

- [ ] **Step 6: Toggle visibility on `speakingEmployeeId` change**

Add a new, separate `useEffect` right after the big employees-sync effect closes (currently ends line 1131, closing with `}, [employees, selectedEmployeeId]);`):

```tsx
  // Chat-active speech bubble: independent of the employees/status sync
  // above so it reacts immediately when a chat starts/stops streaming.
  useEffect(() => {
    avatarsRef.current.forEach((av) => {
      av.speechBubble.visible = av.employeeId === speakingEmployeeId;
    });
  }, [speakingEmployeeId]);
```

- [ ] **Step 7: Pulse it while visible**

In the animate loop, inside the existing `avatarsRef.current.forEach((av) => { ... })` block, right after the existing `auraRing` pulse (currently lines 905-908):

```tsx
        if (av.auraRing) {
          const pulse = 1 + Math.sin(time * 4) * 0.12;
          av.auraRing.scale.set(pulse, pulse, pulse);
        }

        if (av.speechBubble.visible) {
          const bubblePulse = 1 + Math.sin(time * 5) * 0.1;
          av.speechBubble.scale.set(0.5 * bubblePulse, 0.5 * bubblePulse, 1);
        }
```

- [ ] **Step 8: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: PASS, no errors (this also clears the Task 2 `speakingEmployeeId` errors).

- [ ] **Step 9: Manual verification**

Run `npm run dev` (from `web/`), open the Office view, open an employee's chat, send a message. While the reply is streaming (or being spoken, if TTS is on), confirm a small pulsing speech-bubble icon appears above that employee's 3D avatar; confirm it disappears once the reply finishes and when the chat modal is closed. Confirm no console errors.

- [ ] **Step 10: Commit**

```bash
git add web/src/components/OfficeCanvas.tsx
git commit -m "feat(office): show a speech bubble over the actively-chatting avatar"
```

---

### Task 4: Screen-glow pulse while anyone is working

**Files:**
- Modify: `web/src/components/OfficeCanvas.tsx` inside the animate loop, `:824-825` area (before the existing `avatarsRef.current.forEach`) and inside that same `forEach` body

**Interfaces:**
- Consumes: `av.zoneStatus` (already on `AvatarMeshGroup`, set from `Employee.status`) — no new fields.
- Produces: nothing consumed by later tasks.

`matScreenGlow` (created at line 460, `emissiveIntensity: 0.8`) is declared in the same `useEffect` that later defines `animate()`, so it's directly reachable from the animate closure — no ref needed.

- [ ] **Step 1: Track "anyone working" while iterating avatars, then pulse**

Currently (lines 824-909), the loop starts:

```tsx
      const nowS = Date.now() / 1000;
      avatarsRef.current.forEach((av) => {
        const dx = av.targetX - av.currentX;
```

Change to add a flag before the loop and a check inside it:

```tsx
      const nowS = Date.now() / 1000;
      let anyWorking = false;
      avatarsRef.current.forEach((av) => {
        if (av.zoneStatus === 'working') anyWorking = true;
        const dx = av.targetX - av.currentX;
```

Then, right after the `avatarsRef.current.forEach(...)` block closes (currently line 909, `});`), before `renderer.render(scene, camera);`:

```tsx
      });

      matScreenGlow.emissiveIntensity = anyWorking ? 0.75 + Math.sin(time * 3) * 0.25 : 0.8;

      renderer.render(scene, camera);
```

- [ ] **Step 2: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open the Office view, switch to the "Desks" camera preset. With at least one employee `working`, confirm the desk monitor screens visibly pulse in brightness instead of holding a flat glow. With nobody working, confirm screens sit at the previous static glow (no regression when idle).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/OfficeCanvas.tsx
git commit -m "feat(office): pulse desk screen glow while employees are working"
```

---

### Task 5: Presenting pose at the whiteboard POI

**Files:**
- Modify: `web/src/components/OfficeCanvas.tsx:860-867` (standing-pose branch inside the animate loop)

**Interfaces:**
- Consumes: `av.assignedPoi` (already on `AvatarMeshGroup`, already set to the `OfficePOI` object whenever an avatar is assigned a new target — including `MEETING_POIS`, which contains the `id: 'meet-presenter'` entry at line 54).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Branch the standing-pose arm animation**

Currently (lines 860-867):

```tsx
          } else {
            av.leftLegPivot.rotation.x = THREE.MathUtils.lerp(av.leftLegPivot.rotation.x, 0, 0.15);
            av.rightLegPivot.rotation.x = THREE.MathUtils.lerp(av.rightLegPivot.rotation.x, 0, 0.15);
            av.leftArmPivot.rotation.x = THREE.MathUtils.lerp(av.leftArmPivot.rotation.x, 0, 0.15);
            av.rightArmPivot.rotation.x = THREE.MathUtils.lerp(av.rightArmPivot.rotation.x, 0, 0.15);
            av.headMesh.position.y = 1.5 + Math.sin(time * 2) * 0.02;
            av.headMesh.rotation.x = 0;
          }
```

Change to:

```tsx
          } else {
            av.leftLegPivot.rotation.x = THREE.MathUtils.lerp(av.leftLegPivot.rotation.x, 0, 0.15);
            av.rightLegPivot.rotation.x = THREE.MathUtils.lerp(av.rightLegPivot.rotation.x, 0, 0.15);

            // Whoever is standing at the presenter POI gets a raised,
            // gesturing arm instead of the generic resting pose — reads as
            // "presenting" rather than just "standing near the board".
            const isPresenting = av.assignedPoi?.id === 'meet-presenter';
            av.leftArmPivot.rotation.x = THREE.MathUtils.lerp(av.leftArmPivot.rotation.x, 0, 0.15);
            av.rightArmPivot.rotation.x = THREE.MathUtils.lerp(
              av.rightArmPivot.rotation.x,
              isPresenting ? -Math.PI / 2.2 + Math.sin(time * 2) * 0.08 : 0,
              0.15
            );
            av.headMesh.position.y = 1.5 + Math.sin(time * 2) * 0.02;
            av.headMesh.rotation.x = 0;
          }
```

- [ ] **Step 2: Typecheck**

Run (from `web/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open the Office view, switch to the "Meeting" camera preset. Wait for (or trigger) an employee to be assigned to the `meet-presenter` POI (an `in_meeting` employee cycles through `MEETING_POIS` periodically). Confirm that employee's right arm raises toward the whiteboard with a slight gesture sway, while everyone seated at the table keeps the normal seated pose, and other standing/idle employees elsewhere keep the plain resting pose.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/OfficeCanvas.tsx
git commit -m "feat(office): give the whiteboard presenter a distinct pose"
```

---

## Final Verification

- [ ] Run `npm run test` (from `web/`) — confirms typecheck plus the existing unrelated unit-test suite (`parser`, `stream`, `audio`, `commands`, `Markdown`, `detect-box`, `graph`, `sentences`, `stt`, `tts`) is untouched.
- [ ] Manually re-run all three scenarios from Tasks 3, 4, 5 together in one dev-server session (send a chat message during an active meeting with someone working at a desk) — confirm the three cues don't visually clash or fight each other (e.g. bubble position doesn't overlap the name sprite, screen pulse doesn't tank frame rate).
