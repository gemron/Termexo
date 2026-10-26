---
name: one-ring-status
description: Show persisted One Ring task status, actual Worker runs, verification evidence and next steps when the user asks for progress on a 至尊魔戒 workflow.
---

Use `one_ring_list` to locate the task when its ID is unknown, then call `one_ring_status` and relevant `one_ring_events`. Report the actual phase, plan version, current or most recent Worker, verification outcome and next required user action.

Checking status does not authorize work. Do not silently start, repair, resume, accept, or end a task. If execution was interrupted or the workspace changed, explain that state from the records rather than recalling an earlier PASS. Historical or simulated prototype data is not runtime evidence.
