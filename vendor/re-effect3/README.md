# Frozen Effect v3 library for apps

Desktop, Raycast and Overlay consume the single archive in this directory while the workspace library prepares to migrate to Effect v4. The archive contains all five entry points, including `study`; the registry's `@simbyotic/re@0.2.0` does not contain that entry point. App Effect stays at `3.19.18`.

`manifest.json` records the source commit, source patch, build versions, original version, staged version override, baseline checks and SHA-512 integrity. No release or commit was created to produce this artifact. Because the small grading-error correction and its regression were uncommitted, `sourceClean` is explicitly false: the exact reproducible source is the recorded commit **plus `source.patch`**. Unrelated Overlay edits and migration planning documents are not part of this library snapshot.

`source.patch` preserves the public `ReviewGradeError` contract while eliminating an intermediate global `Error` rejected by the language service. It also adds the targeted persistence regression. The patched baseline passed 415 tests in 30 files, typecheck and clean package inspection. This is only the baseline prerequisite from step 2; the wider study test transfer has not been performed.

## Verification and application use

Run `bun run check:app-resolution` to verify the archive/provenance and exercise every app's installed library with its own Effect runtime under Node and Bun. It checks all five entry points and rejects workspace links or different Effect installations. `bun run test:app-isolation` exercises corrupted bytes, wrong pins, accidental workspace resolution and portable exports.

The app dependency is `file:../../vendor/re-effect3/simbyotic-re-0.2.1-effect3.0.tgz`. Desktop/Raycast standalone checks copy the approved bytes, manifest and patch into the export's `vendor/`, then use `file:vendor/...tgz`. They never rebuild the current library. Overlay continues to use the Bun workspace and its existing native build route. Run `bun run check:overlay` on Apple Silicon macOS with the project's Rust, Xcode and Metal prerequisites; native validation is not certified by a portable resolution check.

## Reconstructing the source and archive

Use the versions in `manifest.json`. From the repository root, create a temporary checkout without modifying Git state:

```sh
re_source=$(mktemp -d)
re_repo=$(pwd)
git archive 1a63eb550a79e6f0ef1dde0e769be973c8a3729e | tar -x -C "$re_source"
git -C "$re_source" apply "$re_repo/vendor/re-effect3/source.patch"
bun --cwd="$re_source" install --frozen-lockfile
bun --cwd="$re_source" run --filter '@simbyotic/re' test
bun --cwd="$re_source" run --filter '@simbyotic/re' typecheck
bun --cwd="$re_source" run pack:library
```

The last command builds and inspects the original `0.2.0` archive. Extract it into a second temporary directory, change only the extracted `package/package.json` version to `0.2.1-effect3.0`, and run `bun pm pack --ignore-scripts --destination <temporary-output>` from that extracted `package` directory. Compare the unpacked manifest, JavaScript, declarations, maps and sources with the frozen archive. Gzip/container timestamps need not reproduce identical bytes; the committed archive's SHA-512 remains its identity. Never overwrite the approved archive during a check or rebuild.

## Replacement and removal

A changed snapshot needs a new `effect3` counter, archive filename, provenance and integrity, together with all three app pins and the matching lockfile. Library release preparation preserves these pins. After each app is separately migrated, switch that app to the compatible v4 library and rerun its integration checks. Remove this directory only after no app or standalone export still needs it. Reverting only the app pins to workspace resolution after the workspace has moved to v4 is not a valid rollback.
