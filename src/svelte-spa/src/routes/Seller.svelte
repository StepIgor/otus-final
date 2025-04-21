<script>
  // @ts-nocheck

  import { apiFetch } from "../lib/apiFetch";
  import { onMount } from "svelte";
  import { accessToken, userRoleName } from "../stores/auth";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { v4 as uuidv4 } from "uuid";
  import NavMenu from "../components/NavMenu.svelte";

  let pendingOrders = [];

  onMount(() => {
    if ($userRoleName !== "seller") {
      push("/account");
      return;
    }
    setPendingOrders();
  });

  async function setPendingOrders() {
    const query = await apiFetch("api/orders/v1/seller/orders/pending");
    if (query.status === 401) {
      push("/login");
      return;
    }
    pendingOrders = await query.json();
    pendingOrders = await Promise.all(
      pendingOrders.map(async (order) => {
        const [product, user] = await Promise.all([
          apiFetch(`api/store/v1/products/${order.productid}`).then((res) =>
            res.json()
          ),
          apiFetch(`api/users/v1/users/${order.userid}`).then((res) =>
            res.json()
          ),
        ]);
        return { ...order, productInfo: product, userInfo: user };
      })
    );
  }

  async function completeOrder(id) {
    await apiFetch(`api/orders/v1/seller/orders/${id}/complete`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    });
    setPendingOrders();
  }
  async function declineOrder(id) {
    await apiFetch(`api/orders/v1/seller/orders/${id}/decline`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
    });
    // обновление идёт через цепочку сервисов с задержкой
    pendingOrders = pendingOrders.filter((order) => order.id !== id);
  }
</script>

<main class="blocks-container">
  <NavMenu />
  <div in:fade class="block orders-info-block">
    <span>Заказы, ожидающие действий</span>
    <table>
      <thead>
        <tr>
          <td>Номер</td>
          <td>Дата создания</td>
          <td>Продукт</td>
          <td>№ лицензии</td>
          <td>Цена</td>
          <td>Покупатель</td>
          <td>Действие</td>
        </tr>
      </thead>
      <tbody>
        {#if pendingOrders?.length}
          {#each pendingOrders as order}
            <tr>
              <td>{order.id}</td>
              <td>{new Date(order.createdate).toLocaleString("ru-RU")}</td>
              <td>
                <a href={`#/store/product/${order.productid}`}>
                  {order.productInfo?.title}
                </a>
              </td>
              <td>{order.licenseid}</td>
              <td>{order.price}</td>
              <td>
                <a href={`#/user/${order.userid}`}>
                  {order.userInfo?.nickname}
                </a>
              </td>
              <td>
                <details class="dropdown">
                  <summary>...</summary>
                  <ul>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <li
                      style="color:green;"
                      on:click={() => completeOrder(order.id)}
                    >
                      Завершить
                    </li>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <li
                      style="color:red"
                      on:click={() => declineOrder(order.id)}
                    >
                      Отменить
                    </li>
                  </ul>
                </details>
              </td>
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
  li {
    cursor: pointer;
  }
  li:hover {
    background: var(--pico-text-selection-color);
  }
</style>
