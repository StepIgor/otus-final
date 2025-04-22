<script>
  import { apiFetch } from "../lib/apiFetch";
  import { onMount } from "svelte";
  import { accessToken, userRoleName } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { v4 as uuidv4 } from "uuid";
  import NavMenu from "../components/NavMenu.svelte";

  let notifications = [];

  onMount(() => {
    setNotifications();
    readAll();
  });

  async function setNotifications() {
    const query = await apiFetch("api/notifications/v1/all");
    if (query.status === 401) {
      push("/login");
      return;
    }
    notifications = await query.json();
  }

  async function readAll() {
    await apiFetch("api/notifications/v1/mark-read", { method: "POST" });
  }
</script>

<main class="blocks-container">
  <NavMenu />
  {#each notifications as notification}
    <article in:fade class="block">
      <div class="notif-body">
        <div class="notif-icon">⚠️</div>
        <div class="notif-text">{notification.text}</div>
      </div>
      <footer>
        {new Date(notification.createdate).toLocaleString("ru-RU")}
      </footer>
    </article>
  {/each}
</main>

<style>
  .blocks-container {
    display: flex;
    flex-direction: column;
    gap: 42px;
    align-items: center;
    justify-content: start;
    margin: 64px 0;
  }
  .block {
    width: 66vw;
  }
  .block span {
    font-size: 36px;
    color: #ffffff;
    font-weight: 100;
  }
  footer {
    color: var(--pico-secondary);
  }
  .notif-body {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: start;
    gap: 24px;
  }
  .notif-icon {
    font-size: 36px;
  }
  article {
    margin: 0;
  }
</style>
