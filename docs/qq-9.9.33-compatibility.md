# QQ 9.9.33-51802 Compatibility

The current release targets Windows x64 QQ `9.9.33-51802`.

The installer verifies the official entry point `./application.asar/app_launcher/index.js`
and the SHA-256 of the versioned `application.asar` before writing the LiteLoader
launcher and plugin files. The QQ executable and ASAR are not replaced.

Before installation, fully exit QQ and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
```

Rollback remains available through `rollback.ps1` using the backup created by the
installer.

## Adaptation Notes For Future QQ Updates

When QQ changes its message protocol, inspect the actual IPC objects before changing
the recovery logic. The 9.9.33 update required these specific compatibility rules:

1. Normal group messages arrive through `nodeIKernelMsgListener/onRecvActiveMsg`.
2. Group recall updates arrive through `nodeIKernelMsgListener/onActiveMsgInfoUpdate`.
3. A recall payload can contain both a populated `msgList` and a `msgRecord`. They
   are not alternatives: the list can contain unrelated messages while the recall
   exists only in `msgRecord`. Process both, and write the recovered object back to
   every representation whose message ID matches without changing unrelated items.
4. A group-owner self-recall can omit both `origMsgId` and `origMsgUid`, while its
   outer gray-tip ID differs from the original text or picture. An ID-less fallback
   must require exactly one same-group, same-sender text/picture candidate. Reject
   ambiguous candidates, and keep voice recovery on exact message IDs.
5. QQ can represent one logical message as `elementType: 8` with child fields such
   as `textElement`, `faceElement`, `picElement`, `pttElement`, and `videoElement`.
   Expand those children once before caching. Map a composite voice to one canonical
   `elementType: 4` and retain a `pttElement: null` placeholder until its download
   event supplies the local file.
6. QQ attaches nullable media fields to ordinary elements. Diagnostics must test
   field values, not only property names, or every message will be logged as voice
   and video.

### Safe Investigation Procedure

- Enable the local `ptt-debug.enabled` marker only during a short reproduction.
- Record command names, message IDs, chat type, element types, and cache/restore
  booleans. Do not record message text, account identifiers, temporary URLs, local
  usernames, or absolute installation paths.
- Add a fixture test for each new payload shape before modifying the processor.
- Run `node --test`, `npm run check`, rebuild the delivery package, and verify the
  installed source hash before testing in QQ.
- Disable the marker after reproduction. Diagnostic logs stay local and are not
  included in release archives.
