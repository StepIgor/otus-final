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
  let userOrders;
  let sessions = [];

  let isDepositModalOpened = false;
  let depositAmount = 0;
  let depositUuid;
  let depositErrorText = "";

  let isPersonalInfoEditModalOpened = false;
  let personalInfoEditUuid;
  let [newName, newSurname, newBirthdate] = ["", "", null];
  let personalInfoEditErrorText = "";

  onMount(async () => {
    if (!$accessToken) {
      push("/login");
      return;
    }

    await setCurrentUser();
    setBillingInfo();
    setUserOrders();
    setSessionsInfo();
  });

  async function setSessionsInfo() {
    sessions = await apiFetch("api/users/v1/sessions")
      .then((res) => res.json())
      .then((res) =>
        res.toSorted((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      );
  }

  async function setCurrentUser() {
    const currentUserQuery = await apiFetch("api/users/v1/me");
    if (currentUserQuery.status === 401 || !$accessToken) {
      accessToken.set(null);
      push("/login");
      return;
    }
    currentUser = await currentUserQuery.json();
  }

  async function submitDeposit() {
    depositErrorText = "";
    if (!depositAmount || isNaN(depositAmount) || depositAmount < 0) {
      depositErrorText = "Проверьте корректность указанной суммы";
      return;
    }
    const depositQuery = await apiFetch("api/billing/v1/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid: depositUuid, amount: depositAmount }),
    });
    if (depositQuery.status === 401 || !$accessToken) {
      accessToken.set(null);
      push("/login");
      return;
    }
    if (!depositQuery.ok) {
      depositErrorText = await depositQuery.text();
      return;
    }
    closeDepositModal();
    setBillingInfo();
  }

  async function submitPersonalInfoEdit() {
    personalInfoEditErrorText = "";
    if (!newName || !newSurname || !newBirthdate) {
      personalInfoEditErrorText = "Все поля обязательны для заполнения";
      return;
    }
    const query = await apiFetch("api/users/v1/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        surname: newSurname,
        birthdate: new Date(newBirthdate).toLocaleDateString("en-CA"),
      }),
    });
    if (!query.ok) {
      personalInfoEditErrorText = await query.text();
      return;
    }
    setCurrentUser();
    closePersonalInfoEditModal();
  }

  function closeDepositModal() {
    isDepositModalOpened = false;
  }
  function openDepositModal() {
    depositUuid = uuidv4();
    depositErrorText = "";
    isDepositModalOpened = true;
  }

  function closePersonalInfoEditModal() {
    isPersonalInfoEditModalOpened = false;
  }
  function openPersonalInfoEditModal() {
    personalInfoEditUuid = uuidv4();
    personalInfoEditErrorText = "";
    isPersonalInfoEditModalOpened = true;
    newName = currentUser.name;
    newSurname = currentUser.surname;
    newBirthdate = new Date(currentUser.birthdate).toLocaleDateString("en-CA");
  }

  async function setBillingInfo() {
    //parse billing info
    [userBalance, userTransactions] = await Promise.all([
      apiFetch("api/billing/v1/balance").then((res) => res.json()),
      apiFetch("api/billing/v1/transactions").then((res) => res.json()),
    ]);
  }

  async function setUserOrders() {
    userOrders = await apiFetch("api/orders/v1/orders").then((res) =>
      res.json()
    );
    userOrders = await Promise.all(
      userOrders.map(async (order) => {
        const productInfo = await apiFetch(
          `api/store/v1/products/${order.productid}`
        ).then((res) => res.json());
        return { ...order, productInfo };
      })
    );
  }

  function getOrderStatusTranslation(status) {
    switch (status?.toLowerCase()) {
      case "done":
        return "Завершён";
      case "cancelled":
        return "Отменён";
      case "pending":
        return "Ожидается";
      default:
        return "В обработке";
    }
  }

  async function logout() {
    await apiFetch("api/users/v1/logout", {
      method: "POST",
      credentials: "include",
    });
    accessToken.set(null);
    push("/login");
  }

  async function logoutAll() {
    await apiFetch("api/users/v1/logout-all", {
      method: "POST",
      credentials: "include",
    });
    accessToken.set(null);
    push("/login");
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

{#if isPersonalInfoEditModalOpened}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    in:fade
    out:fade
    class="deposit-overlay"
    on:click|self={closePersonalInfoEditModal}
  >
    <div class="modal">
      <h2>Изменить информацию о себе</h2>
      <input
        type="text"
        bind:value={newName}
        maxlength="64"
        placeholder="Имя"
      />
      <input
        type="text"
        bind:value={newSurname}
        maxlength="64"
        placeholder="Фамилия"
      />
      <input
        type="date"
        bind:value={newBirthdate}
        placeholder="Дата рождения"
      />
      {#if personalInfoEditErrorText}
        <span class="error">{personalInfoEditErrorText}</span>
      {/if}
      <div class="buttons">
        <button on:click={submitPersonalInfoEdit}>Сохранить</button>
        <button class="outline secondary" on:click={closePersonalInfoEditModal}>
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
      <div class="title-one-line">
        <span>Информация о <span>{currentUser.nickname}</span></span>
        <button on:click={openPersonalInfoEditModal}>Изменить ПД</button>
      </div>
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
      <span>Активные сессии ({sessions?.length || 0})</span>
      <details class="dropdown">
        <summary role="button" class="outline secondary"> Закрыть все </summary>
        <ul style="font-size: 12px;padding: 12px;">
          Выйти со всех устройств, в т.ч. текущего?<br />Эффект в течение 10
          минут
          <button style="margin-top: 12px;" on:click={logoutAll}>Выйти</button>
        </ul>
      </details>
    </div>
    <table>
      <thead>
        <tr>
          <td>Дата входа</td>
          <td>Устройство</td>
          <td>IP</td>
        </tr>
      </thead>
      {#if sessions?.length}
        <tbody in:fade>
          {#each sessions as session}
            <tr>
              <td>{new Date(session.createdAt).toLocaleString("ru-RU")}</td>
              <td>{session.userAgent}</td>
              <td>{session.ip}</td>
            </tr>
          {/each}
        </tbody>
      {/if}
    </table>
  </div>

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

  <div class="block billing-info-block">
    <div class="title-one-line">
      <span>Заказы ({userOrders?.length || 0})</span>
    </div>
    <table>
      <thead>
        <tr>
          <td>Номер</td>
          <td>Дата</td>
          <td>Статус</td>
          <td>Товар</td>
          <td>Комментарий</td>
          <td>Цена</td>
        </tr>
      </thead>
      {#if userOrders?.length}
        <tbody in:fade>
          {#each userOrders as order}
            <tr>
              <td>{order.id}</td>
              <td>{new Date(order.createdate).toLocaleString("ru-RU")}</td>
              <td class={order.status}>
                {getOrderStatusTranslation(order.status)}
              </td>
              <td>
                <a href={`#/store/product/${order.productid}`}>
                  {order.productInfo?.title}
                </a>
              </td>
              <td>{order.comment}</td>
              <td>{order.price || "N/A"}</td>
            </tr>
          {/each}
        </tbody>
      {/if}
    </table>
  </div>

  <button class="outline secondary" on:click={logout}>Выйти из аккаунта</button>
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
  .purchase,
  .cancelled {
    color: red;
  }
  .deposit,
  .done {
    color: green;
  }
  .refund,
  .pending,
  .processing {
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
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
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
