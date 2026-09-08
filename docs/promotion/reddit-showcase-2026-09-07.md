# Reddit: r/ClaudeAI weekly showcase

Target: https://www.reddit.com/r/ClaudeAI/comments/1w5q6dx/show_us_what_youve_created_with_claude/

I built Termexo for managing Claude Code sessions on Windows, alongside Codex CLI, OpenCode and ordinary shells. It is MIT-licensed and free to download and use; the agent CLIs still need their own accounts or provider configuration.

The Claude-specific part keeps Claude Code running in a real PTY, reads its native session history for resume, and surfaces when a session needs input or approval. The workbench organizes those sessions instead of replacing the CLI.

The recent addition is browser access from a phone on the same trusted LAN or VPN. The phone writes to the terminal process already running on the Windows host. One useful engineering constraint: that shared PTY has only one row/column size. The active viewer controls it, and other viewers render that same grid.

Current release: V0.8.1, Windows 10/11 x64 only. Remote access is off by default and uses self-signed HTTPS plus a token. The host must stay running, and the token/QR code should stay private.

Source, screenshots and Windows downloads: https://github.com/gemron/Termexo
English guide (also downloadable as PDF): https://www.termexo.com/guide.en.html

For people juggling several Claude Code sessions, which is harder: noticing requests for approval, or finding the right session to resume?

Disclosure: I maintain this project; this description was prepared with AI assistance.
