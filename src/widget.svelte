<script>
  import Modal from "./components/modal.svelte";
  import Mailform from "./components/mailform.svelte";

  export let name = "Internet Explorer";
  export let bio = "A curious traveler who likes to build neat things.";
  export let twitter = "";
  export let instagram = "";
  export let linkedin = "";
  export let facebook = "";
  export let weavemail = "";
  export let github = "";
  export let discord = "";
  export let youtube = "";
  export let twitch = "";
  export let avatar = "";
  export let background = "";

  let icon_repo = "https://social-icons.arweave.dev";
  let mailDialog = false;

  function isEmpty(v) {
    return v.length === 0 ? true : false;
  }
</script>

<div class="h-[900px]">
  <div
    class="bg-[url('{background}')] bg-cover bg-no-repeat w-full h-[660px] mb-[50px]"
  >
    <div class="w-full h-full flex flex-col justify-between relative">
      <ul class="w-full flex flex-row-reverse p-5">
        {#if !isEmpty(facebook)}
          <li>
            <a
              href="https://facebook.com/{facebook}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/facebook-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(linkedin)}
          <li>
            <a
              href="https://www.linkedin.com/in/{linkedin}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/linkedin-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(github)}
          <li>
            <a
              href="https://github.com/{github}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/github-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(discord)}
          <li>
            <a
              href="https://discord.com/users/{discord}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/discord-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(weavemail)}
          <li>
            <button
              on:click={() => (mailDialog = true)}
              style="
          background-image: url({icon_repo}/arweave-mail-icon.png);
        "
              class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
            />
          </li>
        {/if}
        {#if !isEmpty(twitch)}
          <li>
            <a
              href="https://twitch.com/{twitch}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/twitch-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(instagram)}
          <li>
            <a
              href="https://instagram.com/{instagram}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/instagram-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(youtube)}
          <li>
            <a
              href="https://youtube.com/c/{youtube}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/youtube-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(twitter)}
          <li>
            <a
              href="https://twitter.com/{twitter}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/twitter-icon.png);
          "
                class="w-[94px] h-[94px] m-5 rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
      </ul>
      <div class="w-full flex m-5 absolute top-[565px] left-0">
        <img
          alt="avatar"
          src={avatar}
          class="ml-5 mr-5 shadow-xl rounded-full border-4 max-w-[265px] bg-base-300"
        />
        <div class="flex flex-col justify-center">
          <p class="m-1 text-3xl tracking-tight text-base-600">{name}</p>
          <p class="m-1 text-xl text-base-600">{bio}</p>
        </div>
      </div>
    </div>
  </div>
</div>
<Modal open={mailDialog} ok={false}>
  <h3 class="text-2xl text-secondary">Message/Tip {name}</h3>
  <Mailform
    on:mail={() => (mailDialog = false)}
    on:cancel={() => (mailDialog = false)}
  />
</Modal>
