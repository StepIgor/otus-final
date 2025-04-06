<script>
  import { API_PATH } from "../lib/common";
  import { push } from "svelte-spa-router";

  let errorText = "";
  let email = "";
  let nickname = "";
  let password = "";
  let name = "";
  let surname = "";
  let birthdate;

  async function onRegisterBtnClick() {
    if (!email || !nickname || !password || !name || !surname || !birthdate) {
      errorText = "Заполните все поля на форме";
      return;
    }
    try {
      const query = await fetch(`${API_PATH}/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          nickname,
          password,
          name,
          surname,
          birthdate,
        }),
      });
      if (!query.ok) {
        errorText = await query.text();
        return;
      }
      push("/login");
    } catch (err) {
      errorText = err.message;
    }
  }
</script>

<main>
  <div class="form">
    <span class="title"> Регистрация аккаунта </span>
    <div>
      <span>Email</span>
      <input type="email" bind:value={email} maxlength="64" />
    </div>
    <div>
      <span>Логин</span>
      <input type="text" bind:value={nickname} maxlength="64" />
    </div>
    <div>
      <span>Пароль</span>
      <input type="password" bind:value={password} maxlength="32" />
    </div>
    <div>
      <span>Имя</span>
      <input type="text" bind:value={name} maxlength="64" />
    </div>
    <div>
      <span>Фамилия</span>
      <input type="text" bind:value={surname} maxlength="64" />
    </div>
    <div>
      <span>Дата рождения</span>
      <input type="date" bind:value={birthdate} />
    </div>
    <span class="error">{errorText}</span>
    <button on:click={onRegisterBtnClick}>Зарегистрироваться</button>
    <a href="#/login">Перейти на форму входа</a>
    <a href="#/">Вернуться на главную</a>
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
