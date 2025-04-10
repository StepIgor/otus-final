<script>
  // @ts-nocheck

  import { apiFetch } from "../lib/apiFetch";
  import { onMount } from "svelte";
  import { accessToken } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { v4 as uuidv4 } from "uuid";
  import NavMenu from "../components/NavMenu.svelte";

  let currentUser;
  let userBalance;
  let userTransactions;

  let isDepositModalOpened = false;
  let depositAmount = 0;
  let depositUuid;
  let depositErrorText = "";

  async function submitDeposit() {
    depositErrorText = "";
    if (!depositAmount || isNaN(depositAmount) || depositAmount < 0) {
      depositErrorText = "Проверьте корректность указанной суммы";
      return;
    }
    const depositQuery = await apiFetch("/api/billing/v1/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: depositUuid, amount: depositAmount }),
    });
    if (depositQuery.status === 401 || !$accessToken) {
      push("/login");
      return;
    }
    if (!depositQuery.ok) {
      depositErrorText = await depositQuery.text();
      return;
    }
    closeDepositModal();
    getBillingInfo();
  }

  function closeDepositModal() {
    isDepositModalOpened = false;
  }
  function openDepositModal() {
    depositUuid = uuidv4();
    depositErrorText = "";
    isDepositModalOpened = true;
  }

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
    getBillingInfo();
  });

  async function getBillingInfo() {
    //parse billing info
    [userBalance, userTransactions] = await Promise.all([
      apiFetch("/api/billing/v1/balance").then((res) => res.json()),
      apiFetch("/api/billing/v1/transactions").then((res) => res.json()),
    ]);
  }
</script>

{#if isDepositModalOpened}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    in:fade
    out:fade
    class="deposit-overlay"
    on:click|self={closeDepositModal}
  >
    <div class="modal">
      <h2>Пополнить баланс</h2>
      <input type="number" bind:value={depositAmount} min="1" max="1000000" />
      {#if depositErrorText}
        <span class="error">{depositErrorText}</span>
      {/if}
      <div class="buttons">
        <button on:click={submitDeposit}>Пополнить</button>
        <button class="outline secondary" on:click={closeDepositModal}>
          Отмена
        </button>
      </div>
    </div>
  </div>
{/if}

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
    <div class="title-one-line">
      <span>Текущий баланс: <span>{userBalance?.balance || 0}</span> ₽</span>
      <button on:click={openDepositModal}>Пополнить</button>
    </div>
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
  .block span {
    font-size: 36px;
    color: #ffffff;
    font-weight: 100;
  }
  .block span > span {
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

  .error {
    color: var(--pico-del-color);
  }

  .title-one-line {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }

  .deposit-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .deposit-overlay .modal {
    background: var(--pico-background-color);
    padding: 24px;
    border-radius: 12px;
    width: 50vw;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }

  .deposit-overlay input {
    width: 100%;
    padding: 8px;
    margin: 12px 0;
    font-size: 1rem;
  }

  .deposit-overlay .buttons {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
  }
</style>
