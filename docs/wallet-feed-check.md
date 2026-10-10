# Host-to-website connection check

After installing the same publisher credential in the website and rewards host, run this command in the host's authenticated shell:

```sh
node scripts/check-wallet-feed.mjs
```

It reads `ROBIN_WALLET_FEED_URL` and `ROBIN_WALLET_FEED_PUBLISH_TOKEN` from the environment. Do not place the token in command arguments or paste it into logs. The URL must be exactly `https://robinhook.wtf/api/wallet-snapshot` or `https://www.robinhook.wtf/api/wallet-snapshot`.

The command derives `/api/wallet-feed-check` on that same origin and sends one authenticated POST containing a fresh random 16-byte nonce. That endpoint writes and reads an isolated diagnostic record; it never changes the financial wallet snapshot or token identity. Success prints only `{"status":"verified","nonce":"…"}`. Failure exits with code 2 and a generic message, without the credential, provider response, or environment values.

The request has a 15-second deadline, refuses redirects, limits its JSON body to 128 bytes and its response to 512 bytes, and requires an exact acknowledgement of the fresh nonce. It makes no automatic retry. If another diagnostic check causes HTTP 409, wait until that check finishes and rerun explicitly.

A successful check proves that this host can authenticate to the probe and that its diagnostic storage round trip worked. It does not activate rewards, publish wallet data, bind a token, validate chain data, or prove that the first production payout works. Those checks remain separate.
