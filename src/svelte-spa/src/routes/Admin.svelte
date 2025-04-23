<script>
  // @ts-nocheck

  import { apiFetch } from "../lib/apiFetch";
  import { onMount } from "svelte";
  import { accessToken, userRoleName } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { v4 as uuidv4 } from "uuid";
  import NavMenu from "../components/NavMenu.svelte";

  let users = [];

  let isNewUserModalOpened = false;
  let [
    newUserEmail,
    newUserName,
    newUserSurname,
    newUserNickname,
    isNewUserAdmin,
    newUserPassword,
    newUserBirthdate,
  ] = ["", "", "", "", false, "", null];
  let newUserErrorText = "";

  onMount(() => {
    if ($userRoleName !== "admin") {
      push("/account");
      return;
    }
    setUsers();
  });

  async function setUsers() {
    const query = await apiFetch("api/users/v1/admin/users");
    if (query.status === 401) {
      push("/login");
      return;
    }
    users = await query.json();
  }

  function closeNewUserModal() {
    isNewUserModalOpened = false;
  }
  function openNewUserModal() {
    newUserEmail = "";
    newUserName = "";
    newUserSurname = "";
    newUserNickname = "";
    isNewUserAdmin = false;
    newUserPassword = "";
    newUserBirthdate = null;

    newUserErrorText = "";
    isNewUserModalOpened = true;
  }

  async function submitNewUser() {
    if (
      !newUserEmail ||
      !newUserName ||
      !newUserSurname ||
      !newUserNickname ||
      !newUserPassword ||
      !newUserBirthdate
    ) {
      newUserErrorText = "Проверьте заполнение всех полей";
      return;
    }
    const query = await apiFetch("api/users/v1/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: newUserEmail,
        nickname: newUserNickname,
        password: newUserPassword,
        name: newUserName,
        surname: newUserSurname,
        birthdate: new Date(newUserBirthdate).toLocaleDateString("en-CA"),
        role: isNewUserAdmin ? "admin" : "seller",
      }),
    });
    if (!query.ok) {
      newUserErrorText = await query.text();
      return;
    }
    closeNewUserModal();
    setUsers();
  }
</script>

{#if isNewUserModalOpened}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div in:fade out:fade class="modal-overlay" on:click|self={closeNewUserModal}>
    <div class="modal">
      <h2>Зарегистрировать {isNewUserAdmin ? "администратора" : "издателя"}</h2>
      <input
        type="text"
        bind:value={newUserEmail}
        maxlength="64"
        placeholder="Email"
      />
      <input
        type="text"
        bind:value={newUserNickname}
        maxlength="64"
        placeholder="Логин"
      />
      <input
        type="text"
        bind:value={newUserName}
        maxlength="64"
        placeholder="Имя"
      />
      <input
        type="text"
        bind:value={newUserSurname}
        maxlength="64"
        placeholder="Фамилия"
      />
      <label>
        <input type="radio" bind:group={isNewUserAdmin} value={true} />
        Администратор
      </label>
      <label>
        <input type="radio" bind:group={isNewUserAdmin} value={false} />
        Издатель
      </label>
      <input
        type="date"
        bind:value={newUserBirthdate}
        placeholder="Дата рождения"
      />
      <input
        type="password"
        bind:value={newUserPassword}
        maxlength="64"
        placeholder="Пароль"
      />
      {#if newUserErrorText}
        <span class="error">{newUserErrorText}</span>
      {/if}
      <div class="buttons">
        <button on:click={submitNewUser}>Зарегистрировать</button>
        <button class="outline secondary" on:click={closeNewUserModal}>
          Отмена
        </button>
      </div>
    </div>
  </div>
{/if}

<main class="blocks-container">
  <NavMenu />
  <div in:fade class="block">
    <div class="title-one-line">
      <span>Зарегистрированные пользователи ({users?.length || 0})</span>
      <button on:click={openNewUserModal}>Регистрация нового</button>
    </div>
    <table>
      <thead>
        <tr>
          <td>ID</td>
          <td>Логин</td>
          <td>Email</td>
          <td>Имя</td>
          <td>Роль</td>
          <td>Дата рождения</td>
        </tr>
      </thead>
      <tbody>
        {#if users?.length}
          {#each users as user}
            <tr>
              <td>{user.id}</td>
              <td>{user.nickname}</td>
              <td>{user.email}</td>
              <td>{user.name} {user.surname}</td>
              <td>{user.role}</td>
              <td>{new Date(user.birthdate).toLocaleDateString("ru-RU")}</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</main>

<style>
  .blocks-container {
    display: flex;
    flex-direction: column;
    gap: 48px;
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
  .title-one-line {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-overlay .modal {
    background: var(--pico-background-color);
    padding: 24px;
    border-radius: 12px;
    width: 50vw;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }

  .modal-overlay input[type="text"] {
    width: 100%;
    padding: 8px;
    margin: 12px 0;
    font-size: 1rem;
  }

  .modal-overlay .buttons {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
  }

  label {
    margin: 12px 0 24px 0;
  }

  .error {
    color: var(--pico-del-color);
  }
</style>
