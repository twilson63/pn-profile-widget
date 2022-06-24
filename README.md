# PermaPages Profile Widget

A permapages widget is a simple html, javascript, and tailwindcss block of code that can provide nice dynamic widgets on your personal permapage sites.

This widget is the profile widget that allows any user to publish a profile on their permapage using a HTML snippet.

```html
<div id="profile" data-name="rakis" data-description="Arweave Developer" />
<script src="https://arweave.net/_gpYZeRcqcgP98FNo_fh54wFhu52bDH8tbHV8JAgaFs"></script>
```

Notice the script is uploaded to Arweave, this means that it will live along side the permapage and never be deleted.


## Deploy

```sh
npm i -g arkb
arkb deploy dist --use-bundler https://node2.bundlr.network --wallet mywallet.json
```

## Current Version

https://arweave.net/_gpYZeRcqcgP98FNo_fh54wFhu52bDH8tbHV8JAgaFs

