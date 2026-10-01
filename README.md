# TV Channels Card

A Home Assistant dashboard card for watching IPTV: channel tiles in tabs, one HLS player and a programme guide. Built as the companion card of the [IPTV Proxy integration](https://github.com/ohnoitsfraa/iptv_proxy), so it works at home, remotely over https (Nabu Casa) and in the companion app.

- **Channel tiles** with logos, grouped in tabs (e.g. `NL`, `BE`, `Sport`). The last tab you used is remembered.
- **One player**: hls.js, or native HLS on Safari/iOS. Only one stream runs at a time, which helps with provider connection limits.
- **Programme guide**: what's on now with a progress bar on every tile, and the current programme, its description and the next three programmes below the player.
- **Search**: the magnifier button searches all of your provider's channels by name and the guide of your configured channels by programme title. Tap a channel, or a programme that's on now, to start watching. Needs IPTV Proxy 1.2.0 or newer.
- **Films and series**: search results also list your provider's films and series. A series opens its seasons and episodes. Playback uses the provider's HLS version when there is one, and otherwise the file itself, so you can seek. Needs IPTV Proxy 1.3.0 or newer.
- **Subtitles**: when a film or episode has subtitles the browser can show, a subtitles button appears next to Stop. Your last choice of language is remembered.
- **Stops by itself** when the pop-up it lives in closes, or when the card leaves the page.
- **Theme-aware**: it uses your theme's colours in light and dark mode, and has one configurable accent colour.
- **English and Dutch** texts, following your Home Assistant language.

<p align="center">
  <img src="https://github.com/ohnoitsfraa/tv-channels-card/blob/main/images/playing.png?raw=true" alt="Watching RTL 4: programme guide with the current show, its description and what's up next, above the channel tiles" width="720">
</p>

<details>
<summary>Idle state, before picking a channel</summary>
<p align="center"><img src="https://github.com/ohnoitsfraa/tv-channels-card/blob/main/images/overview.png?raw=true" alt="Idle player with channel tiles showing what's on now" width="560"></p>
</details>

## Requirements

- The [IPTV Proxy](https://github.com/ohnoitsfraa/iptv_proxy) integration, recommended for https, logos and the guide. Alternatively, direct HLS URLs (see `source_hls` below).
- Home Assistant 2024.4 or newer.

## Installation

### Via HACS (recommended)

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ohnoitsfraa&repository=tv-channels-card&category=plugin)

1. In HACS, open **⋮ → Custom repositories**, add `https://github.com/ohnoitsfraa/tv-channels-card` with type **Dashboard**, and click **Add**. The button above does the same in one click.
2. Search for **TV Channels Card** and click **Download**. HACS registers the resource `/hacsfiles/tv-channels-card/tv-channels-card.js` for you.
3. Hard-reload your browser (Cmd/Ctrl+Shift+R).

### Manual

Copy `tv-channels-card.js` to `/config/www/`, then add it under **Settings → Dashboards → ⋮ → Resources** as `/local/tv-channels-card.js`, type **JavaScript module**.

## Configuration

```yaml
type: custom:tv-channels-card
proxy: /api/iptv_proxy
channels:
  - { group: NL, name: NPO 1, id: "1359", logo: "http://picon.example.net/npo1.png" }
  - { group: NL, name: RTL 4, id: "1356", logo: "http://picon.example.net/rtl4.png" }
  - { group: BE, name: VRT 1, id: "1420208", logo: "http://picon.example.net/vrt1.png" }
```

| Option | Default | Description |
|---|---|---|
| `channels` | *required* | List of channels (see below). |
| `proxy` | — | Base path of the IPTV Proxy integration, normally `/api/iptv_proxy`. Enables https playback, proxied logos and the guide. |
| `source_hls` | — | Alternative to `proxy`: a direct HLS URL template with `{id}`, e.g. `http://host/live/USER/PASS/{id}.m3u8`. It only works when Home Assistant is opened over **http**, because browsers block http streams on https pages. The URL, including any credentials, ends up in your dashboard config. |
| `hash` | `#tv` | URL hash of the pop-up the card lives in, e.g. a Bubble Card pop-up. Playback stops when the hash changes, and the guide only refreshes while it matches. Set it to `''` when the card sits directly on a view. |
| `accent` | `#a78bfa` | Accent colour: active tile, progress bars and the idle screen. |
| `epg` | `true` | Set to `false` to hide the programme guide. |
| `vod` | `true` | Set to `false` to leave films and series out of search. |
| `language` | Home Assistant language | `en` or `nl`. |
| `hls_js` | jsDelivr hls.js 1.7.3 | URL of the hls.js ES module, if you want to host it yourself. |

**Channel fields:**

| Field | Description |
|---|---|
| `name` | Name shown on the tile. |
| `id` | The provider's Xtream stream id, as a string. |
| `group` | Tab name. Channels without a group go into one "Channels" tab. |
| `logo` | Logo URL. The provider's original `http://` URL is fine in proxy mode, because it's loaded through the proxy. |

### In a Bubble Card pop-up

```yaml
type: custom:bubble-card
card_type: pop-up
hash: "#tv"
name: TV
icon: mdi:television-classic
cards:
  - type: custom:tv-channels-card
    proxy: /api/iptv_proxy
    hash: "#tv"
    channels: [...]
```

## Finding stream ids

With IPTV Proxy 1.2.0 or newer, run the `iptv_proxy.find_channels` action in **Developer tools → Actions** (for example `query: de zdf`). It returns the `id`, `name`, `group` and `logo` you need for a channel entry. Otherwise, stream ids come from your provider's Xtream API (`player_api.php?username=…&password=…&action=get_live_streams`, together with `get_live_categories` for the group names), or from an IPTV app that shows them. Keep your credentials out of shared configs. With the proxy, the card never needs them.

## Notes

- **Connection limit:** most providers allow one stream at a time, so the card only runs one player. Switching channels very quickly can briefly fail. Tap again after a second.
- **Latency:** playback is 10–20 seconds behind live, which is normal for HLS.
- **Guide gaps:** the guide depends on your provider. Channels without guide data simply show no programme line.

## Disclaimer

Use with a legitimate IPTV subscription and respect your provider's terms and local law. Not affiliated with Home Assistant, Nabu Casa or any IPTV provider.
