<script>
  import { apiFetch } from "../lib/apiFetch";
  import { onMount } from "svelte";
  import { accessToken, userRoleName } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { v4 as uuidv4 } from "uuid";
  import NavMenu from "../components/NavMenu.svelte";

  let notifications = [];
  let unreadNotificationsCounter = 0;

  onMount(async () => {
    await Promise.all([setNotifications(), setUnreadNotificationsCounter()]);
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

  async function setUnreadNotificationsCounter() {
    unreadNotificationsCounter = await apiFetch(
      "api/notifications/v1/unread-count"
    )
      .then((res) => res.json())
      .then((res) => res.unread || 0);
  }
</script>

<main class="blocks-container">
  <NavMenu />
  {#each notifications as notification, ind}
    <article in:fade class="block">
      {#if ind < unreadNotificationsCounter}
        <div class="new">НОВОЕ</div>
      {/if}
      <div class="notif">
        <div class="notif-body">
          <div class="notif-icon">⚠️</div>
          <div class="notif-text">{notification.text}</div>
        </div>
        <div class="footer">
          {new Date(notification.createdate).toLocaleString("ru-RU")}
        </div>
      </div>
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
  .footer {
    color: var(--pico-secondary);
    margin-top: 8px;
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
  .notif {
    padding: 16px;
  }
  article {
    margin: 0;
    padding: 0;
  }
  .empty-new {
    height: 21px;
  }
  .new {
    width: 100%;
    padding: 6px 0;
    text-align: center;
    background: linear-gradient(90deg, #00c853, #64dd17, #00c853);
    background-size: 200% 100%;
    animation: gradientShift 3s ease-in-out infinite;
    color: white;
    font-size: 0.9rem;
    font-weight: bold;
    letter-spacing: 8px;
    text-transform: uppercase;
    box-shadow: 0 0 8px rgba(0, 200, 83, 0.5);
  }

  @keyframes gradientShift {
    0% {
      background-position: 0% 0%;
    }
    50% {
      background-position: 100% 0%;
    }
    100% {
      background-position: 0% 0%;
    }
  }
</style>
