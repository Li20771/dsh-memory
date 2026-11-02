# MemoryPack v1.1 cross-repo fixtures

`memorypack.v1.1.dsh-memory.json` is a **synthetic** MemoryPack v1.1.0 produced by
the dsh-memory producer. It is not a real vault export and contains no real
workspace, credential, provider or DSH data.

## Regenerate

From the `dsh-memory` repository root:

```text
node tools/memorypack.fixture.mjs tools/fixtures/memorypack.v1.1.dsh-memory.json
```

The generator builds a temporary synthetic vault, runs the offline MemoryPack
producer with a fixed trusted context and `now`, and writes the pack JSON. It
performs no network, provider, DSH, MCP or real-vault access. Do not hand-edit
the JSON; regenerate it.

## Source

- Repository: `dsh-memory`
- Base main commit: `4270b6886bf71804ac173155d60320c0c2f43d5c`
- Branch: `fix/fleet-v3-round2-memory-hardening` (round-2 hardening working tree)
- Contract: `MEMORYPACK_V1_1.md` v1.1.0

## Contents

The fixture exercises:

- an approved `ws_a` / `ep_1` episode-shared note;
- an approved explicit `user-global` note with no origin scope, emitted with the
  reserved owner `workspace_id: "global"`;
- an approved Unicode NFC path note (`2026-10-30-结论.md`) that must stay NFC;
- a foreign `ws_b` note that must not appear in entries or excluded counts;
- a pending note counted in `excluded.pending`;
- an unmarked legacy note counted in `excluded.unmarked`;
- `policy.cross_workspace: true` derived from the actual emitted entries.

## Consumer

The Workbench repository validates this generated pack in its cross-repo
MemoryPack v1.1 schema/semantic test (version, scope, role, entry fields, NFC
paths, `excluded` counts, layer-then-code-point entry order,
`policy.cross_workspace`, and `snapshot_hash` consistency). The pack is copied
unchanged into Workbench's own fixture directory; this repository does not
connect to Workbench at runtime. Any producer change that alters the canonical
entry set or its deterministic ordering must regenerate this file and update the
Workbench expectation in the same contract-coordination step.
