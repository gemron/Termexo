//! Tunnel control frames: the JSON carried by the WebSocket text frames of a tunnel.
//!
//! The shape follows the workbench's own `/ws` frames — a `type` discriminator in kebab-case and
//! camelCase members — so both protocols read the same way on the wire and in a packet capture.

use serde::{Deserialize, Serialize};

/// Bumped whenever a frame changes in a way an older peer cannot ignore. A relay refuses a `hello`
/// it cannot speak rather than guessing, so the panel can say "中继版本过旧 / 过新".
pub const PROTOCOL_VERSION: u32 = 1;

/// What is on the far end of a tunnel. A downstream relay is just a device that announces devices
/// of its own, which is what lets cascading reuse this protocol unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceKind {
    Desktop,
    Relay,
}

/// One public URL a device can be reached at, on one relay of the chain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAddress {
    pub relay_id: String,
    pub relay_name: String,
    pub url: String,
    /// How many relays the traffic crosses beyond the entry one; 0 is a directly attached device.
    pub hops: u32,
}

/// A device a downstream relay makes visible to its upstream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncedDevice {
    pub id: String,
    pub name: String,
    pub online: bool,
    /// The relays the announcement travelled through, nearest announcer first. A receiver that
    /// finds its own id here drops the entry, which is one half of the loop guard.
    pub via: Vec<String>,
}

/// Every frame the control plane of a tunnel can carry, in both directions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ControlFrame {
    /// Device to relay, first frame after the upgrade.
    Hello {
        protocol: u32,
        kind: DeviceKind,
        version: String,
        name: String,
        /// Only a downstream relay has an id of its own to declare.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        relay_id: Option<String>,
    },
    /// Relay to device, the answer to an accepted `hello`.
    Welcome {
        device_id: String,
        relay_id: String,
        addresses: Vec<RelayAddress>,
        /// The upstream relay ids up to the top of the chain; seeing your own id means a loop.
        chain: Vec<String>,
    },
    /// Relay to device, pushed whenever the upstream chain changes the reachable addresses.
    Addresses {
        addresses: Vec<RelayAddress>,
    },
    /// Relay to device, immediately before closing with [`crate::tunnel::CLOSE_REVOKED`].
    Revoked {
        reason: String,
    },
    /// Relay to device, immediately before closing with [`crate::tunnel::CLOSE_UNAUTHORIZED`].
    AuthFailed {
        reason: String,
    },
    /// Downstream relay to upstream: the full snapshot, sent as soon as the tunnel is up.
    Announce {
        devices: Vec<AnnouncedDevice>,
    },
    /// Downstream relay to upstream: one device appeared.
    DeviceOnline {
        id: String,
        name: String,
        via: Vec<String>,
    },
    /// Downstream relay to upstream: one device went away.
    DeviceOffline {
        id: String,
    },
    Ping,
    Pong,
}

impl ControlFrame {
    /// Renders the frame as the JSON of one WebSocket text frame.
    pub fn encode(&self) -> String {
        // Every variant is built from strings, numbers and vectors of those, so the only documented
        // failure modes of `to_string` (a non-string map key, a failing custom `Serialize`) cannot
        // occur here.
        serde_json::to_string(self).expect("control frames are plain JSON-compatible data")
    }

    pub fn decode(text: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_encodes_with_a_kebab_case_tag_and_camel_case_members() {
        let frame = ControlFrame::Hello {
            protocol: PROTOCOL_VERSION,
            kind: DeviceKind::Desktop,
            version: "0.9.0".into(),
            name: "书房台式机".into(),
            relay_id: None,
        };

        assert_eq!(
            frame.encode(),
            r#"{"type":"hello","protocol":1,"kind":"desktop","version":"0.9.0","name":"书房台式机"}"#
        );
    }

    #[test]
    fn hello_carries_the_relay_id_only_for_a_downstream_relay() {
        let frame = ControlFrame::Hello {
            protocol: PROTOCOL_VERSION,
            kind: DeviceKind::Relay,
            version: "0.9.0".into(),
            name: "office".into(),
            relay_id: Some("relay-b".into()),
        };

        assert_eq!(
            frame.encode(),
            r#"{"type":"hello","protocol":1,"kind":"relay","version":"0.9.0","name":"office","relayId":"relay-b"}"#
        );
    }

    #[test]
    fn welcome_encodes_addresses_and_chain() {
        let frame = ControlFrame::Welcome {
            device_id: "abcdefghijklmnopqrstuvwxyz".into(),
            relay_id: "relay-a".into(),
            addresses: vec![RelayAddress {
                relay_id: "relay-a".into(),
                relay_name: "公网中继".into(),
                url: "https://relay-a.example.com/d/abcdefghijklmnopqrstuvwxyz/".into(),
                hops: 0,
            }],
            chain: vec!["relay-a".into()],
        };

        assert_eq!(
            frame.encode(),
            concat!(
                r#"{"type":"welcome","deviceId":"abcdefghijklmnopqrstuvwxyz","relayId":"relay-a","#,
                r#""addresses":[{"relayId":"relay-a","relayName":"公网中继","#,
                r#""url":"https://relay-a.example.com/d/abcdefghijklmnopqrstuvwxyz/","hops":0}],"#,
                r#""chain":["relay-a"]}"#
            )
        );
    }

    #[test]
    fn unit_frames_encode_to_a_bare_tag() {
        assert_eq!(ControlFrame::Ping.encode(), r#"{"type":"ping"}"#);
        assert_eq!(ControlFrame::Pong.encode(), r#"{"type":"pong"}"#);
    }

    #[test]
    fn every_frame_survives_a_round_trip() {
        let frames = vec![
            ControlFrame::Hello {
                protocol: PROTOCOL_VERSION,
                kind: DeviceKind::Relay,
                version: "0.9.0".into(),
                name: "office".into(),
                relay_id: Some("relay-b".into()),
            },
            ControlFrame::Addresses {
                addresses: vec![RelayAddress {
                    relay_id: "relay-a".into(),
                    relay_name: "relay a".into(),
                    url: "https://relay-a.example.com/d/device/".into(),
                    hops: 1,
                }],
            },
            ControlFrame::Revoked {
                reason: "接入已被中继撤销。".into(),
            },
            ControlFrame::AuthFailed {
                reason: "中继版本过旧。".into(),
            },
            ControlFrame::Announce {
                devices: vec![AnnouncedDevice {
                    id: "device".into(),
                    name: "办公室电脑".into(),
                    online: true,
                    via: vec!["relay-b".into()],
                }],
            },
            ControlFrame::DeviceOnline {
                id: "device".into(),
                name: "办公室电脑".into(),
                via: vec!["relay-b".into()],
            },
            ControlFrame::DeviceOffline {
                id: "device".into(),
            },
            ControlFrame::Ping,
            ControlFrame::Pong,
        ];

        for frame in frames {
            assert_eq!(
                ControlFrame::decode(&frame.encode()).expect("the frame should decode"),
                frame
            );
        }
    }

    #[test]
    fn a_missing_relay_id_decodes_as_none() {
        let decoded = ControlFrame::decode(
            r#"{"type":"hello","protocol":1,"kind":"desktop","version":"0.9.0","name":"pc"}"#,
        )
        .expect("the frame should decode");

        assert_eq!(
            decoded,
            ControlFrame::Hello {
                protocol: 1,
                kind: DeviceKind::Desktop,
                version: "0.9.0".into(),
                name: "pc".into(),
                relay_id: None,
            }
        );
    }

    #[test]
    fn an_unknown_frame_type_is_rejected() {
        assert!(ControlFrame::decode(r#"{"type":"teapot"}"#).is_err());
    }
}
