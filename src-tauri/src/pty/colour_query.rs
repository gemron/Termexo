//! Answers the colour queries a program sends its terminal, from the PTY itself.
//!
//! Codex CLI 0.154 asks for the default foreground and background (OSC 10 and OSC 11) when it
//! starts, and OpenCode 1.18 does the same, to shade their input boxes. Codex waits about a tenth
//! of a second for the answer and reads anything later as typing. Left to the viewers, every xterm
//! showing the terminal answered: the second viewer's copy, or a phone's copy that crossed the relay
//! after the window had closed, was typed into the prompt as `]11;rgb:0e0e/1616/1a1a\`.
//!
//! Answering here gives the program exactly one reply, at once, however many viewers are watching
//! and wherever they are. The queries are taken out of the output as well, so no viewer sees one to
//! answer — not live, and not when the scrollback is replayed.

use thiserror::Error;

const ESCAPE: u8 = 0x1b;

/// The two ways an operating system command may be terminated; a reply ends the way its query did.
const BELL: &str = "\x07";
const STRING_TERMINATOR: &str = "\x1b\\";

#[derive(Debug, Error, PartialEq, Eq)]
#[error("invalid terminal colour {0:?}; expected #rrggbb")]
pub struct InvalidColour(String);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rgb {
    red: u8,
    green: u8,
    blue: u8,
}

impl Rgb {
    fn from_hex(value: &str) -> Result<Self, InvalidColour> {
        let invalid = || InvalidColour(value.to_owned());
        let digits = value.strip_prefix('#').ok_or_else(invalid)?;
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(invalid());
        }
        let channel = |start: usize| u8::from_str_radix(&digits[start..start + 2], 16);
        Ok(Self {
            red: channel(0).map_err(|_| invalid())?,
            green: channel(2).map_err(|_| invalid())?,
            blue: channel(4).map_err(|_| invalid())?,
        })
    }

    /// The colour as xterm reports it: four hex digits a channel, each byte repeated, which is the
    /// 8-bit value scaled to 16 bits.
    fn report(self) -> String {
        format!(
            "rgb:{0:02x}{0:02x}/{1:02x}{1:02x}/{2:02x}{2:02x}",
            self.red, self.green, self.blue
        )
    }
}

/// The colours a terminal is drawn in, which its colour queries are answered with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalPalette {
    foreground: Rgb,
    background: Rgb,
}

impl TerminalPalette {
    pub fn from_hex(foreground: &str, background: &str) -> Result<Self, InvalidColour> {
        Ok(Self {
            foreground: Rgb::from_hex(foreground)?,
            background: Rgb::from_hex(background)?,
        })
    }

    fn colour(self, slot: ColourSlot) -> Rgb {
        match slot {
            ColourSlot::Foreground => self.foreground,
            ColourSlot::Background => self.background,
        }
    }
}

/// Which dynamic colour a query asks for, numbered as the OSC it arrives in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ColourSlot {
    Foreground = 10,
    Background = 11,
}

struct ColourQuery {
    sequence: &'static [u8],
    slot: ColourSlot,
    terminator: &'static str,
}

/// Every form of the two queries: Codex terminates them with ST, OpenCode with BEL.
const COLOUR_QUERIES: [ColourQuery; 4] = [
    ColourQuery {
        sequence: b"\x1b]10;?\x1b\\",
        slot: ColourSlot::Foreground,
        terminator: STRING_TERMINATOR,
    },
    ColourQuery {
        sequence: b"\x1b]10;?\x07",
        slot: ColourSlot::Foreground,
        terminator: BELL,
    },
    ColourQuery {
        sequence: b"\x1b]11;?\x1b\\",
        slot: ColourSlot::Background,
        terminator: STRING_TERMINATOR,
    },
    ColourQuery {
        sequence: b"\x1b]11;?\x07",
        slot: ColourSlot::Background,
        terminator: BELL,
    },
];

enum Match {
    Query(&'static ColourQuery),
    /// The data ran out partway through what may still become a query.
    Incomplete,
    NotQuery,
}

/// Reads the escape sequence `data` starts with.
fn match_query(data: &[u8]) -> Match {
    let mut incomplete = false;
    for query in &COLOUR_QUERIES {
        if data.starts_with(query.sequence) {
            return Match::Query(query);
        }
        incomplete |= query.sequence.starts_with(data);
    }
    if incomplete {
        Match::Incomplete
    } else {
        Match::NotQuery
    }
}

/// What remains of a chunk of output once its colour queries are answered.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct AnsweredOutput {
    /// The output for the viewers and the replay history, without the queries.
    pub display: Vec<u8>,
    /// The answers to write back to the program, in the order it asked.
    pub replies: Vec<u8>,
}

/// Takes colour queries out of a terminal's output and answers them, one read at a time.
#[derive(Default)]
pub struct ColourQueryResponder {
    /// The start of a query cut off by the end of the previous read, held for the next one.
    carry: Vec<u8>,
}

impl ColourQueryResponder {
    /// Answers the colour queries in `chunk` from `palette`.
    ///
    /// Without a palette nothing is taken out, and the viewers answer as they would with any other
    /// terminal. A query cut in two by the end of a read is held back whole until the read that
    /// completes it; nothing a viewer could draw is ever held, since an unfinished escape sequence
    /// draws nothing.
    pub fn answer(&mut self, chunk: &[u8], palette: Option<TerminalPalette>) -> AnsweredOutput {
        let mut data = std::mem::take(&mut self.carry);
        data.extend_from_slice(chunk);
        let Some(palette) = palette else {
            return AnsweredOutput {
                display: data,
                replies: Vec::new(),
            };
        };

        let mut answered = AnsweredOutput {
            display: Vec::with_capacity(data.len()),
            replies: Vec::new(),
        };
        let mut rest = data.as_slice();
        while let Some(offset) = rest.iter().position(|&byte| byte == ESCAPE) {
            answered.display.extend_from_slice(&rest[..offset]);
            rest = &rest[offset..];
            match match_query(rest) {
                Match::Query(query) => {
                    let reply = format!(
                        "\x1b]{};{}{}",
                        query.slot as u8,
                        palette.colour(query.slot).report(),
                        query.terminator
                    );
                    answered.replies.extend_from_slice(reply.as_bytes());
                    rest = &rest[query.sequence.len()..];
                }
                Match::Incomplete => {
                    self.carry = rest.to_vec();
                    rest = &[];
                }
                Match::NotQuery => {
                    answered.display.push(ESCAPE);
                    rest = &rest[1..];
                }
            }
        }
        answered.display.extend_from_slice(rest);
        answered
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOREGROUND_REPORT: &[u8] = b"\x1b]10;rgb:cfcf/d9d9/dada\x1b\\";
    const BACKGROUND_REPORT: &[u8] = b"\x1b]11;rgb:0e0e/1616/1a1a\x1b\\";

    fn palette() -> Option<TerminalPalette> {
        Some(TerminalPalette::from_hex("#cfd9da", "#0e161a").unwrap())
    }

    #[test]
    fn answers_codex_queries_and_takes_them_out_of_the_output() {
        let mut responder = ColourQueryResponder::default();

        let answered = responder.answer(b"before\x1b]10;?\x1b\\\x1b]11;?\x1b\\after", palette());

        assert_eq!(answered.display, b"beforeafter");
        assert_eq!(
            answered.replies,
            [FOREGROUND_REPORT, BACKGROUND_REPORT].concat()
        );
    }

    #[test]
    fn a_query_ended_with_bell_is_answered_with_bell() {
        let mut responder = ColourQueryResponder::default();

        let answered = responder.answer(b"\x1b]11;?\x07", palette());

        assert!(answered.display.is_empty());
        assert_eq!(answered.replies, b"\x1b]11;rgb:0e0e/1616/1a1a\x07");
    }

    #[test]
    fn a_query_cut_by_the_end_of_a_read_is_answered_when_it_completes() {
        let mut responder = ColourQueryResponder::default();

        let first = responder.answer(b"text\x1b]1", palette());
        let second = responder.answer(b"1;?\x1b\\more", palette());

        assert_eq!(first.display, b"text");
        assert!(first.replies.is_empty());
        assert_eq!(second.display, b"more");
        assert_eq!(second.replies, BACKGROUND_REPORT);
    }

    #[test]
    fn other_escape_sequences_pass_through_untouched() {
        let mut responder = ColourQueryResponder::default();
        let output = b"\x1b]0;title\x07\x1b[31mred\x1b]11;rgb:0000/0000/0000\x1b\\\x1b]4;1;?\x07";

        let answered = responder.answer(output, palette());

        assert_eq!(answered.display, output);
        assert!(answered.replies.is_empty());
    }

    #[test]
    fn a_held_prefix_that_turns_out_not_to_be_a_query_is_released_intact() {
        let mut responder = ColourQueryResponder::default();

        let first = responder.answer(b"\x1b]", palette());
        let second = responder.answer(b"0;title\x07", palette());

        assert!(first.display.is_empty());
        assert_eq!(
            [first.display, second.display].concat(),
            b"\x1b]0;title\x07"
        );
    }

    #[test]
    fn without_a_palette_the_queries_are_left_for_the_viewers() {
        let mut responder = ColourQueryResponder::default();
        let output = b"\x1b]10;?\x1b\\\x1b]11;?\x07";

        let answered = responder.answer(output, None);

        assert_eq!(answered.display, output);
        assert!(answered.replies.is_empty());
    }

    #[test]
    fn rejects_colours_that_are_not_six_hex_digits() {
        assert!(TerminalPalette::from_hex("#cfd9da", "#0e161a").is_ok());
        for invalid in ["cfd9da", "#cfd9d", "#cfd9dag", "rgb(0,0,0)", ""] {
            assert_eq!(
                TerminalPalette::from_hex(invalid, "#000000"),
                Err(InvalidColour(invalid.to_owned()))
            );
        }
    }
}
