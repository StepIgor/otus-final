<script>
  import { apiFetch } from "../lib/apiFetch";
  import { onMount } from "svelte";
  import { accessToken } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import NavMenu from "../components/NavMenu.svelte";

  let currentUser;
  let userBalance;
  let userTransactions;

  onMount(async () => {
    if (!$accessToken) {
      push("/login");
      return;
    }

    //parse user info
    const currentUserQuery = await apiFetch("/api/users/v1/me");
    if (currentUserQuery.status === 401 || !$accessToken) {
      push("/login");
      return;
    }
    currentUser = await currentUserQuery.json();

    //parse billing info
    [userBalance, userTransactions] = await Promise.all([
      apiFetch("/api/billing/v1/balance").then((res) => res.json()),
      apiFetch("/api/billing/v1/transactions").then((res) => res.json()),
    ]);
  });
</script>

<main class="blocks-container">
  <NavMenu />
  {#if currentUser}
    <div in:fade class="block user-info-block">
      <span>Информация о <span>{currentUser.nickname}</span></span>
      <table>
        <tbody>
          <tr>
            <td> Email </td>
            <td>{currentUser.email}</td>
          </tr>
          <tr>
            <td> Логин </td>
            <td>{currentUser.nickname}</td>
          </tr>
          <tr>
            <td> Имя </td>
            <td>{currentUser.name}</td>
          </tr>
          <tr>
            <td> Фамилия </td>
            <td>{currentUser.surname}</td>
          </tr>
          <tr>
            <td> Дата рождения </td>
            <td
              >{new Date(currentUser.birthdate).toLocaleDateString("ru-RU")}</td
            >
          </tr>
          <tr>
            <td> Роль </td>
            <td>{currentUser.rolename}</td>
          </tr>
        </tbody>
      </table>
    </div>
  {/if}
  <div class="block billing-info-block">
    <span>Текущий баланс: <span>{userBalance?.balance || 0}</span> ₽</span>
    <table>
      <thead>
        <tr><td> Описание</td><td> Дата</td><td> Сумма</td></tr>
      </thead>
      {#if userTransactions?.transactions}
        <tbody in:fade>
          {#each userTransactions.transactions as transaction}
            <tr>
              <td>{transaction.description}</td>
              <td>{new Date(transaction.createdate).toLocaleString("ru-RU")}</td
              >
              <td class={transaction.type.toLowerCase()}>
                {transaction.amount}
              </td>
            </tr>
          {/each}
        </tbody>
      {/if}
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
  .block > span {
    font-size: 36px;
    color: #ffffff;
    font-weight: 100;
  }
  .block > span > span {
    color: var(--pico-primary);
  }
  .purchase {
    color: red;
  }
  .deposit {
    color: green;
  }
  .refund {
    color: orange;
  }
</style>
