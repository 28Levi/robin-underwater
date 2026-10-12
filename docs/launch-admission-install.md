# Installing a reviewed launch on the standby host

`scripts/install-launch-admission.mjs` installs public launch evidence into the worker's dedicated durable launch directory. It runs offline: it never contacts Programmable or RPC, reads a signing key, signs, broadcasts, changes host configuration, or starts services. It does not validate current platform availability or replace final wallet review.

Run it on the worker host with the exact final `manifest.json`, its independently reviewed SHA-256 digest, and the source commit actually running on that host. For a v1 manifest that is `sourceRevision`; v2/v3/v4 manifests bind the running code with `workerSourceRevision` and preserve `sourceRevision` for the approved contract package. The CLI also checks the explicit revision against `ROBIN_SOURCE_REVISION` or `RENDER_GIT_COMMIT` when configured, using the same precedence as the standby. Use the same absolute directory configured as `ROBIN_LAUNCH_STATE_DIRECTORY` for `launch-standby.mjs`.

```sh
node scripts/install-launch-admission.mjs \
  --manifest /path/to/reviewed/manifest.json \
  --manifest-sha256 sha256:REPLACE_WITH_EXACT_REVIEWED_DIGEST \
  --source-revision "$RENDER_GIT_COMMIT" \
  --state-directory /var/data/robin/launch
```

This writes `admission.json`, a single envelope binding the manifest and digest. The running standby process can then verify and pin that package. The installer uses the standby's default filenames; custom `ROBIN_LAUNCH_ADMISSION_FILE` or `ROBIN_LAUNCH_CONSENT_FILE` overrides must be reconciled before using it.

To deliver an already existing review file recorded by the local wallet review server after the user's explicit review, add:

```sh
  --consent /path/to/reviewed/launch-review.json
```

The review is checked by the existing `validateLaunchConsent` policy against the exact manifest, account, nonce, automation choice, risk acknowledgement, execution limits and review timestamp. Its bytes are preserved. The installer cannot cryptographically establish who created a local JSON file; only transfer the actual review-server output through a trusted host administration channel. Never construct or edit a review file to satisfy a gate. Choosing `after-reviewed-launch` in a manifest alone does not supply consent.

All inputs and existing destinations are checked before publication. Completed file contents are fsynced, then published through exclusive hard links on the same filesystem, so admission never appears partially written and existing files are never replaced. If supplied, consent is published first and admission last. After an interrupted review-first installation, rerun with the identical explicit review input. A filesystem without hard-link support fails closed; there is no overwrite fallback.

An exact rerun preserves existing bytes and succeeds. A changed package, changed review, different pinned manifest, symlinked path, stale install lock, or runtime state with missing admission fails closed. Preserve existing state and investigate; do not clear journals or locks to force installation. This tool assumes trusted local filesystem administrators and does not isolate itself from another process with permission to mutate the same directories.

A worker-only revision change does not permit this installer to replace an existing admission. Reconcile any previous unlaunched review through the explicit host replacement procedure, preserving all evidence and unresolved wallet attempts. Prepare new local consent and a new host acknowledgement for the changed manifest; an old review or acknowledgement cannot carry over. Moving from serial v3 to pipelined v4 requires this same exact review, including its confirmation mode and in-flight bound. Never reset operator journals or change the platform package to install a worker fix.

Successful installation only reports delivery. It does not set `ROBIN_AUTOMATION_APPROVED_MANIFEST_SHA256`, add `--services`, authorize operator spending, or confirm a successful token launch. The separate existing consent, exact host approval, finality and contract verification gates still apply. Final production integration and a controlled post-launch payout remain necessary.
