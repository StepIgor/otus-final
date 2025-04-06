<script>
  import { API_PATH } from "../lib/common";
  import { accessToken } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import {onMount} from 'svelte';

  let errorText = "";
  let login = "";
  let password = "";

  onMount(() => {
    if ($accessToken) {
      push('/account');
    }
  });

  async function onLoginBtnClick() {
    if (!login || !password) {
      errorText = "Заполните оба обязательных поля";
      return;
    }
    try {
      const query = await fetch(`${API_PATH}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login,
          password,
        }),
      });
      if (!query.ok) {
        errorText = await query.text();
        return;
      }
      accessToken.set(await query.json().then((res) => res.accessToken));
      push("/account");
    } catch (err) {
      errorText = err.message;
    }
  }
</script>

<main>
  <div class="form">
    <span class="title"> Вход в аккаунт </span>
    <div>
      <span>Логин или email</span>
      <input type="email" bind:value={login} maxlength="32" />
    </div>
    <div>
      <span>Пароль</span>
      <input type="password" bind:value={password} maxlength="32" />
    </div>
    <span class="error">{errorText}</span>
    <button on:click={onLoginBtnClick}>Войти</button>
    <a href="#/">Вернуться на главную</a>
    <a href="#/register">Завести новый аккаунт</a>
  </div>
</main>

<style>
  .form {
    width: 100vw;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  .form > .title {
    text-align: center;
    font-size: 24px;
    font-weight: bold;
    margin: 24px 0;
    color: var(--pico-primary);
  }
  .form > div {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: start;
    width: 16vw;
  }
  .form > a {
    color: var(--pico-secondary);
    text-decoration: none;
  }
  .error {
    color: var(--pico-del-color);
  }
</style>
