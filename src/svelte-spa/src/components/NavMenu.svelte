<script>
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { userLogin, userRoleName } from "../stores/auth";
  import { apiFetch } from "../lib/apiFetch";
  import { fade } from "svelte/transition";

  const currentHash = writable("");
  let unreadNotificationsCount = 0;

  onMount(() => {
    const update = () => currentHash.set(window.location.hash);
    update();
    window.addEventListener("hashchange", update);
    setUnreadNotificationsCount();
    const notificationsUpdaterInterval = setInterval(
      setUnreadNotificationsCount,
      20000
    );
    return () => {
      window.removeEventListener("hashchange", update);
      clearInterval(notificationsUpdaterInterval);
    };
  });

  async function setUnreadNotificationsCount() {
    try {
      const query = await apiFetch("api/notifications/v1/unread-count");
      if (query.ok) {
        unreadNotificationsCount = await query
          .json()
          .then((res) => res.unread || 0);
      }
    } catch (err) {
      unreadNotificationsCount = 0;
    }
  }
</script>

<div class="container">
  <a href="#/" class:active={$currentHash === "#/"}>Главная</a>
  <a href="#/account" class:active={$currentHash === "#/account"}>
    {$userLogin}
  </a>
  {#if $userRoleName === "seller"}
    <a href="#/seller" class:active={$currentHash === "#/seller"}>Издатель</a>
  {/if}
  {#if $userRoleName === "admin"}
    <a href="#/admin" class:active={$currentHash === "#/admin"}>Администратор</a>
  {/if}
  <a href="#/store" class:active={$currentHash === "#/store"}>Магазин</a>
  <a href="#/library" class:active={$currentHash === "#/library"}>Библиотека</a>
  <a href="#/notifications" class:active={$currentHash === "#/notifications"}>
    Уведомления
    {#if unreadNotificationsCount && $currentHash !== "#/notifications"}
      <span in:fade class="notification-counter">{unreadNotificationsCount}</span>
    {/if}
  </a>
</div>

<style>
  .container {
    display: flex;
    flex-direction: row;
    gap: 16px;
    align-items: center;
    justify-content: start;
  }
  .container > a {
    text-decoration: none;
    font-weight: 100;
    color: var(--pico-secondary);
    font-size: 24px;
  }
  .container > a.active {
    font-weight: 700;
    color: var(--pico-primary);
    border-bottom: 2px solid var(--pico-primary);
  }
  .notification-counter {
    background: linear-gradient(135deg, #00c853, #64dd17);
    color: white;
    font-weight: 600;
    font-size: 14px;
    padding: 4px 8px;
    border-radius: 999px;
    box-shadow: 0 0 6px rgba(0, 200, 83, 0.6);
    animation: pulse 1.8s infinite ease-in-out;
    display: inline-block;
    min-width: 24px;
    text-align: center;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 6px rgba(0, 200, 83, 0.6);
    }
    50% {
      box-shadow: 0 0 12px rgba(0, 200, 83, 0.9);
    }
    100% {
      box-shadow: 0 0 6px rgba(0, 200, 83, 0.6);
    }
  }
</style>
