<script>
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { userLogin, userRoleName } from "../stores/auth";

  const currentHash = writable("");

  onMount(() => {
    const update = () => currentHash.set(window.location.hash);
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  });
</script>

<div class="container">
  <a href="#/" class:active={$currentHash === "#/"}>Главная</a>
  <a href="#/account" class:active={$currentHash === "#/account"}>
    {$userLogin}
  </a>
  {#if $userRoleName === "seller"}
    <a href="#/seller" class:active={$currentHash === "#/seller"}>Издатель</a>
  {/if}
  <a href="#/store" class:active={$currentHash === "#/store"}>Магазин</a>
  <a href="#/library" class:active={$currentHash === "#/library"}>Библиотека</a>
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
</style>
