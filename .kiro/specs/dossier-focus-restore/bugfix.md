# Bugfix Requirements Document

## Introduction

Inside the dossier modal, the Recovery Dossier lists the code markers (TODO, FIXME, and similar) found in a project. Each marker has a button that toggles it in or out of the Kiro Spec. When a keyboard or screen reader user activates the "+ Include in Kiro Spec" toggle, the dialog re-renders the evidence grid and the focused button is destroyed. Focus then falls back to the document body, so the user must navigate back into the dialog from the start to continue.

The track-selection buttons already keep focus after activation. This fix extends that behavior to the Kiro toggle, and it leaves every other dialog behavior unchanged.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user activates the "+ Include in Kiro Spec" (or "✓ Included in Kiro Spec") toggle THEN the system re-renders the evidence grid and keyboard focus is lost, so the focus no longer rests on any control in the dossier dialog

1.2 WHEN focus has been lost after toggling the Kiro Spec inclusion THEN the user must press Tab repeatedly from the start of the dialog to reach the toggle again

### Expected Behavior (Correct)

2.1 WHEN the user activates the "+ Include in Kiro Spec" or "✓ Included in Kiro Spec" toggle THEN the system SHALL re-render the evidence grid and keep focus on that same toggle button, with the button's new label

2.2 WHEN the user activates a marker track-selection button THEN the system SHALL re-render the evidence grid and keep focus on that same track-selection button

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user activates a track-selection button or the Kiro Spec toggle THEN the system SHALL CONTINUE TO update the selected track, the Kiro Spec inclusion state, the CRT readout, and the Kiro export exactly as before

3.2 WHEN the dossier is opened, refreshed after a language change, or refreshed after a story update THEN the system SHALL CONTINUE TO render the evidence grid without moving focus

3.3 WHEN the user presses Tab or Shift+Tab inside the open dossier dialog THEN the system SHALL CONTINUE TO cycle focus among the dialog controls

3.4 WHEN the user presses Escape with the dossier dialog open THEN the system SHALL CONTINUE TO close only the topmost active layer

3.5 WHEN the user activates the Kiro Spec toggle THEN the system SHALL CONTINUE TO apply the toggle to the active marker currently shown in the evidence grid
