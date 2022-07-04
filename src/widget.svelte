<script>
  import Modal from "./components/modal.svelte";
  import Mailform from "./components/mailform.svelte";
  import { getProfile } from "./lib/arweave.js";

  export let addr = "";

  let icon_repo =
    "https://arweave.net/T2Kh2uOv3myw8L6BPE6kySs2QXjh8R3B1KolcW_MFQA";
  //let icon_repo = "https://social-icons.arweave.dev";
  let mailDialog = false;
  let sending = false;
  const defaultBackground = icon_repo + "/background.svg";
  const defaultAvatar = icon_repo + "/avatar.svg";
  //let backgroundUrl = background ? background : icon_repo + "/background.svg";
  //let avatarUrl = avatar ? avatar : icon_repo + "/avatar.svg";
  function isEmpty(v) {
    if (!v) {
      return true;
    }
    return v?.length === 0 ? true : false;
  }
</script>

{#await getProfile(addr) then profile}
  <div class="md:hidden h-[400px]">
    <div
      class="bg-[url('{profile.background ||
        defaultBackground}')] bg-cover bg-no-repeat w-full h-[100px] mb-[10px]"
    >
      <figure class="flex justify-center">
        <img
          alt="avatar"
          src={profile.avatar || defaultAvatar}
          class="shadow-xl rounded-full border-4 h-[250px] w-[250px] bg-base-300"
        />
      </figure>
      <div class="flex flex-col justify-center ml-8">
        <p class="m-1 text-3xl tracking-tight text-base-600">{profile.name}</p>
        <p class="m-1 text-xl text-base-600">
          {profile.bio || "A curious traveler who likes to build neat things."}
        </p>
      </div>
      <ul class="w-full flex flex-row-reverse space-x-4 p-5">
        {#if !isEmpty(profile.links.facebook)}
          <li>
            <a
              href="https://facebook.com/{profile.links.facebook}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
        background-image: url({icon_repo}/facebook-icon.png);
      "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.links.linkedin)}
          <li>
            <a
              href="https://www.linkedin.com/in/{profile.links.linkedin}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/linkedin-icon.png);
          "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.links.github)}
          <li>
            <a
              href="https://github.com/{profile.links.github}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/github-icon.png);
          "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.links.discord)}
          <li>
            <a
              href="https://discord.com/users/{profile.links.discord}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/discord-icon.png);
          "
                class="w-[32px] h-[32px]  rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.owner)}
          <li>
            <button
              on:click={() => (mailDialog = true)}
              style="
          background-image: url({icon_repo}/arweave-mail-icon.png);
        "
              class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
            />
          </li>
        {/if}
        {#if !isEmpty(profile.links.twitch)}
          <li>
            <a
              href="https://twitch.com/{profile.links.twitch}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/twitch-icon.png);
          "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.links.instagram)}
          <li>
            <a
              href="https://instagram.com/{profile.links.instagram}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/instagram-icon.png);
          "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.links.youtube)}
          <li>
            <a
              href="https://youtube.com/c/{profile.links.youtube}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/youtube-icon.png);
          "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
        {#if !isEmpty(profile.links.twitter)}
          <li>
            <a
              href="https://twitter.com/{profile.links.twitter}"
              target="_blank"
              rel="noreferrer"
            >
              <button
                style="
            background-image: url({icon_repo}/twitter-icon.png);
          "
                class="w-[32px] h-[32px] rounded-xl bg-cover bg-no-repeat"
              />
            </a>
          </li>
        {/if}
      </ul>
    </div>
  </div>
  <div class="hidden md:block h-[450px]">
    <div
      class="bg-[url('{profile.background ||
        defaultBackground}')] bg-cover bg-no-repeat w-full h-[300px] mb-[50px]"
    >
      <div class="w-full h-full flex flex-col justify-between relative">
        <ul class="w-full flex flex-row-reverse p-5">
          {#if !isEmpty(profile.links.facebook)}
            <li>
              <a
                href="https://facebook.com/{profile.links.facebook}"
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
          {#if !isEmpty(profile.links.linkedin)}
            <li>
              <a
                href="https://www.linkedin.com/in/{profile.links.linkedin}"
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
          {#if !isEmpty(profile.links.github)}
            <li>
              <a
                href="https://github.com/{profile.links.github}"
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
          {#if !isEmpty(profile.links.discord)}
            <li>
              <a
                href="https://discord.com/users/{profile.links.discord}"
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
          {#if !isEmpty(profile.owner)}
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
          {#if !isEmpty(profile.links.twitch)}
            <li>
              <a
                href="https://twitch.com/{profile.links.twitch}"
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
          {#if !isEmpty(profile.links.instagram)}
            <li>
              <a
                href="https://instagram.com/{profile.links.instagram}"
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
          {#if !isEmpty(profile.links.youtube)}
            <li>
              <a
                href="https://youtube.com/c/{profile.links.youtube}"
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
          {#if !isEmpty(profile.links.twitter)}
            <li>
              <a
                href="https://twitter.com/{profile.links.twitter}"
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
        <div class="w-full flex m-5 absolute top-[200px] left-0">
          <img
            alt="avatar"
            src={profile.avatar || defaultAvatar}
            class="ml-5 mr-5 shadow-xl rounded-full border-4 h-[250px] w-[250px] bg-base-300"
          />
          <div class="flex flex-col justify-center">
            <p class="m-1 text-3xl tracking-tight text-base-600">
              {profile.name}
            </p>
            <p class="m-1 text-xl text-base-600">
              {profile.bio ||
                "A curious traveler who likes to build neat things."}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
  <Modal open={mailDialog} ok={false}>
    <h3 class="text-2xl text-secondary">Message/Tip {profile.name}</h3>
    <Mailform
      address={profile.owner}
      on:sending={() => {
        mailDialog = false;
        sending = true;
      }}
      on:mail={() => {
        mailDialog = false;
        sending = false;
      }}
      on:cancel={() => {
        mailDialog = false;
        sending = false;
      }}
    />
  </Modal>
{:catch err}
  Profile not found!
{/await}

<Modal open={sending} ok={false}>
  <h3 class="text-2xl text-secondary">Sending message...</h3>
</Modal>
