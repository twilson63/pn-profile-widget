<script>
  import { createEventDispatcher } from "svelte";

  export let address = "";

  const dispatch = createEventDispatcher();
  const arweave = Arweave.init({});

  async function send(e) {
    if (!arweave) {
      alert("Arweave is required!");
    }
    if (!arweaveWallet) {
      alert("ArConnect is required!");
    }
    const formData = new FormData(e.target);
    const address = formData.get("to");
    var content = formData.get("content");
    const subject = formData.get("subject");
    const mailTagUnixTime = Math.round(new Date().getTime() / 1000);
    var tokens = formData.get("donate");
    if (tokens == "") {
      tokens = "0";
    }
    tokens = arweave.ar.arToWinston(tokens);
    var pub_key = await get_public_key(address);
    if (pub_key == undefined) {
      alert("Recipient has to send a transaction to the network, first!");
      return;
    }
    content = await encrypt_mail(content, subject, pub_key);
    try {
      var tx = await arweave.createTransaction({
        target: address,
        data: arweave.utils.concatBuffers([content]),
        quantity: tokens,
      });
      tx.addTag("App-Name", "permamail");
      tx.addTag("App-Version", "0.0.2");
      tx.addTag("Unix-Time", mailTagUnixTime);
      await arweave.transactions.sign(tx, "use_wallet");
      await arweave.transactions.post(tx);

      alert("Mail dispatched!");
      e.target.reset();
      dispatch("mail", tx.id);
    } catch (err) {
      alert("ERROR trying to send mail!");
      e.target.reset();
      dispatch("cancel");
    }
  }

  async function encrypt_mail(content, subject, pub_key) {
    var content_encoder = new TextEncoder();
    var newFormat = JSON.stringify({ subject: subject, body: content });
    var mail_buf = content_encoder.encode(newFormat);
    var key_buf = await generate_random_bytes(256);
    // Encrypt data segments
    var encrypted_mail = await arweave.crypto.encrypt(mail_buf, key_buf);
    var encrypted_key = await window.crypto.subtle.encrypt(
      {
        name: "RSA-OAEP",
      },
      pub_key,
      key_buf
    );
    // Concatenate and return them
    return arweave.utils.concatBuffers([encrypted_key, encrypted_mail]);
  }

  async function decrypt_mail(enc_data, key) {
    var enc_key = new Uint8Array(enc_data.slice(0, 512));
    var enc_mail = new Uint8Array(enc_data.slice(512));
    var symmetric_key = await window.crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      key,
      enc_key
    );
    return arweave.crypto.decrypt(enc_mail, symmetric_key);
  }

  // utils
  async function wallet_to_key(wallet) {
    var w = Object.create(wallet);
    w.alg = "RSA-OAEP-256";
    w.ext = true;
    var algo = { name: "RSA-OAEP", hash: { name: "SHA-256" } };
    return await crypto.subtle.importKey("jwk", w, algo, false, ["decrypt"]);
  }

  async function get_public_key(address) {
    var txid = await arweave.wallets.getLastTransactionID(address);
    if (txid == "") {
      return undefined;
    }
    var tx = await arweave.transactions.get(txid);
    if (tx == undefined) {
      return undefined;
    }
    var pub_key = arweave.utils.b64UrlToBuffer(tx.owner);
    var keyData = {
      kty: "RSA",
      e: "AQAB",
      n: tx.owner,
      alg: "RSA-OAEP-256",
      ext: true,
    };
    var algo = { name: "RSA-OAEP", hash: { name: "SHA-256" } };
    return await crypto.subtle.importKey("jwk", keyData, algo, false, [
      "encrypt",
    ]);
  }
  async function generate_random_bytes(length) {
    var array = new Uint8Array(length);
    window.crypto.getRandomValues(array);
    return array;
  }
  function isWalletAvail() {
    return Object.keys(window).includes("arweaveWallet");
  }
</script>

<h1 class="text-3xl modal-title">Write to me!</h1>
<div class="alert alert-info my-8 flex-col">
  <p>
    To send a message, you need an Arweave wallet, if you do not have an Arweave
    wallet go to and install ArConnect in your browser.
  </p>
  <a class="link" href="https://arconnect.io" target="_blank" rel="noreferrer"
    >ArConnect</a
  >
</div>
<form id="weavemailForm" on:submit|preventDefault={send}>
  <div class="modal-body">
    <input type="hidden" name="to" value={address} />
    <div class="form-control">
      <label class="label" for="subject">Subject</label>
      <input
        class="input input-bordered"
        type="text"
        placeholder="Subject"
        name="subject"
        id="subject"
      />
    </div>
    <div class="form-control">
      <label class="label" for="content">Mail contents</label>
      <textarea
        class="textarea textarea-bordered h-16"
        id="content"
        name="content"
        placeholder="Hello there..."
      />
    </div>
    <div class="form-control">
      <label class="label" for="donate"> (Optional) Send me AR</label>
      <input
        class="input input-bordered"
        type="text"
        placeholder="0 AR"
        name="donate"
        id="donate"
      />
    </div>
  </div>

  <div class="mt-8 modal-action">
    <button class="btn">Send</button>
    <button
      type="button"
      class="btn btn-outline"
      on:click={() => dispatch("cancel")}>Cancel</button
    >
  </div>
</form>
