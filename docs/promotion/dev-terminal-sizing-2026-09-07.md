# One PTY, two screens: choosing who controls terminal size

A browser terminal can look responsive while showing the wrong grid.

Imagine a desktop displaying 140 columns and a phone displaying 48. Both clients are attached to the same running command-line application. If each emulator independently resizes itself to its container, the application still receives only one terminal size. Cursor positioning and line wrapping can then disagree between the application and one of its viewers.

This is a state-ownership problem hiding inside a layout problem.

## Separate three sizes

There are three quantities worth naming:

- **Container size:** the pixels available in one browser.
- **Proposed grid:** the rows and columns that fit that container at its current font size.
- **Accepted grid:** the rows and columns the host has applied to the shared terminal.

On Windows, [ResizePseudoConsole](https://learn.microsoft.com/en-us/windows/console/resizepseudoconsole) takes the pseudoconsole handle and a character-grid size. It changes the dimensions seen by attached console applications. Meanwhile, [xterm.js resize](https://xtermjs.org/docs/api/terminal/classes/terminal/#resize) changes a client emulator's grid.

Calling the browser method does not, by itself, coordinate the host or the other browser.

A useful invariant is: every viewer of the same terminal should render the host's accepted grid. A narrower container can scroll horizontally. It should not silently invent a different number of columns for the same live output.

## Choose an ownership policy

Several policies are reasonable, with different costs.

| Policy | Benefit | Cost |
| --- | --- | --- |
| Fixed desktop grid | Stable desktop layout | Phones need horizontal scrolling |
| Smallest attached viewport | Content fits every viewer | One passive phone can shrink everyone's terminal |
| Active viewer owns the grid | Layout follows the person interacting | Changing devices changes the grid for every viewer |

The third policy needs an explicit distinction between **reporting a size** and **claiming control**. A background window opening a sidebar is a size report. An intentional interaction with the terminal can be a claim.

Do not make every resize observer callback a claim. Otherwise, background layout changes can take ownership back immediately after the user switches devices.

## A small state machine

The core decision can be expressed separately from networking and rendering:

```typescript
type Grid = { cols: number; rows: number };
type ViewportState = { owner: string | null; grid: Grid };

function mayResize(owner: string | null, viewer: string, claim: boolean) {
  return owner === null || owner === viewer || claim;
}
```

This is illustrative policy code, not a complete terminal server. The surrounding handler needs to:

1. Authenticate the connection and validate positive integer dimensions within supported limits.
2. Serialize ownership and resize decisions for each terminal.
3. Reject passive reports from viewers that do not own it.
4. Apply the requested grid to the host terminal.
5. After success, commit the accepted state and broadcast it to every viewer.

Clients then resize their emulators from that accepted event. Keeping a local proposal separate avoids treating an unacknowledged request as an accomplished resize.

An owner change can matter even if the dimensions stay identical. Deduplicating messages only by rows and columns would lose that handoff.

## Disconnects and failure cases

When an owner disconnects, clearing ownership while retaining the last accepted grid avoids a surprise resize for remaining readers. The next intentional interaction can claim ownership. A reconnecting client should obtain the current grid before presenting the session as ready.

Failed host resizes should leave the previously accepted grid authoritative. Rapid claims from two clients need a defined order. If the protocol uses multiple channels or asynchronous handlers, include a revision number or another ordering mechanism; broadcasting dimensions alone does not establish that order.

Sharing terminal dimensions also does not solve input ownership. Allowing two clients to type into the same process is a separate product decision.

## Checks that reveal the bug

A useful manual exercise is to attach a wide desktop and a narrow phone, then:

- Interact on the phone and confirm both emulators adopt the same accepted dimensions.
- Resize a passive desktop panel and confirm it does not steal ownership.
- Switch control back to the desktop while a full-screen terminal application is open.
- Disconnect the active viewer and check that the remaining screen keeps its grid.
- Simulate a rejected resize and verify that clients keep the last accepted state.

These are suggested checks, not a report of a new device test run. They target the boundary between local layout and shared state, where ordinary single-window testing misses the problem.

*AI disclosure: This article was generated by an AI agent from the author's terminal-workbench implementation notes, with technical claims checked against the relevant source code and the API documentation linked above. The code sample is illustrative.*
