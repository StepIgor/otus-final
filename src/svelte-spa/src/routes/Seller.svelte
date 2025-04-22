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
  let sellerProducts = [];
  let dropdowns = {};

  let isNewProdModalOpened = false;
  let isEditProdModalOpened = false;
  let productToEditId = null;
  let newProdTitle = "";
  let newProdDescription = "";
  let isNewProdDigital = true;
  let newProductPrice = null;
  let newProdSystemRequirements = "";
  let newProdErrorText = "";

  onMount(() => {
    if ($userRoleName !== "seller") {
      push("/account");
      return;
    }
    setPendingOrders();
    setSellerProducts();
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

  async function setSellerProducts() {
    const query = await apiFetch("api/store/v1/seller/products");
    if (query.status === 401) {
      push("/login");
      return;
    }
    sellerProducts = await query
      .json()
      .then((res) => res.toSorted((a, b) => a.title?.localeCompare(b.title)));
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

  function closeNewProductModal() {
    isNewProdModalOpened = false;
  }
  function openNewProductModal() {
    newProdTitle = "";
    newProdDescription = "";
    isNewProdDigital = true;
    newProductPrice = null;
    newProdSystemRequirements = "";
    newProdErrorText = "";
    isNewProdModalOpened = true;
  }

  async function submitNewProduct() {
    if (
      !newProdTitle ||
      !newProdDescription ||
      !newProdSystemRequirements ||
      !newProductPrice ||
      isNaN(newProductPrice)
    ) {
      newProdErrorText = "Проверьте корректность заполнения всех полей";
      return;
    }
    const query = await apiFetch("api/store/v1/seller/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newProdTitle,
        description: newProdDescription,
        type: isNewProdDigital ? "digital" : "physical",
        price: newProductPrice,
        systemrequirements: newProdSystemRequirements,
      }),
    });
    if (!query.ok) {
      newProdErrorText = await query.text();
      return;
    }
    closeNewProductModal();
    setSellerProducts();
  }

  function closeEditProductModal() {
    isEditProdModalOpened = false;
  }
  function openEditProductModal(prod) {
    dropdowns[prod.id].open = false;
    productToEditId = prod.id;
    newProdTitle = prod.title;
    newProdDescription = prod.description;
    newProductPrice = prod.price;
    newProdSystemRequirements = prod.systemrequirements;
    newProdErrorText = "";
    isEditProdModalOpened = true;
  }

  async function submitEditedProduct() {
    if (
      !newProdTitle ||
      !newProdDescription ||
      !newProdSystemRequirements ||
      !newProductPrice ||
      isNaN(newProductPrice)
    ) {
      newProdErrorText = "Проверьте корректность заполнения всех полей";
      return;
    }
    const query = await apiFetch(
      `api/store/v1/seller/products/${productToEditId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newProdTitle,
          description: newProdDescription,
          price: newProductPrice,
          systemrequirements: newProdSystemRequirements,
        }),
      }
    );
    if (!query.ok) {
      newProdErrorText = await query.text();
      return;
    }
    closeEditProductModal();
    setSellerProducts();
  }
</script>

{#if isNewProdModalOpened}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    in:fade
    out:fade
    class="new-product-overlay"
    on:click|self={closeNewProductModal}
  >
    <div class="modal">
      <h2>Опубликовать новый продукт</h2>
      <input
        type="text"
        bind:value={newProdTitle}
        maxlength="64"
        placeholder="Название"
      />
      <textarea
        type="text"
        bind:value={newProdDescription}
        maxlength="8096"
        placeholder="Описание"
      ></textarea>
      <label>
        <input type="checkbox" bind:checked={isNewProdDigital} />
        Цифровая версия
      </label>
      <input
        type="number"
        bind:value={newProductPrice}
        placeholder="Стоимость"
      />
      <textarea
        type="text"
        bind:value={newProdSystemRequirements}
        maxlength="2048"
        placeholder="Системные требования"
      ></textarea>
      {#if newProdErrorText}
        <span class="error">{newProdErrorText}</span>
      {/if}
      <div class="buttons">
        <button on:click={submitNewProduct}>Опубликовать</button>
        <button class="outline secondary" on:click={closeNewProductModal}>
          Отмена
        </button>
      </div>
    </div>
  </div>
{/if}

{#if isEditProdModalOpened}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    in:fade
    out:fade
    class="new-product-overlay"
    on:click|self={closeEditProductModal}
  >
    <div class="modal">
      <h2>Редактировать продукт</h2>
      <input
        type="text"
        bind:value={newProdTitle}
        maxlength="64"
        placeholder="Название"
      />
      <textarea
        type="text"
        bind:value={newProdDescription}
        maxlength="8096"
        placeholder="Описание"
      ></textarea>
      <input
        type="number"
        bind:value={newProductPrice}
        placeholder="Стоимость"
      />
      <textarea
        type="text"
        bind:value={newProdSystemRequirements}
        maxlength="2048"
        placeholder="Системные требования"
      ></textarea>
      {#if newProdErrorText}
        <span class="error">{newProdErrorText}</span>
      {/if}
      <div class="buttons">
        <button on:click={submitEditedProduct}>Сохранить</button>
        <button class="outline secondary" on:click={closeEditProductModal}>
          Отмена
        </button>
      </div>
    </div>
  </div>
{/if}

<main class="blocks-container">
  <NavMenu />
  <div in:fade class="block orders-info-block">
    <span>Заказы, ожидающие действий ({pendingOrders?.length || 0})</span>
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
  <div in:fade class="block products-info-block">
    <div class="title-one-line">
      <span>Опубликованные товары ({sellerProducts?.length || 0})</span>
      <button on:click={openNewProductModal}>Опубликовать</button>
    </div>
    <table>
      <thead>
        <tr>
          <td>ID</td>
          <td>Дата публикации</td>
          <td>Название</td>
          <td>Тип</td>
          <td>Цена</td>
          <td>Действие</td>
        </tr>
      </thead>
      <tbody>
        {#if sellerProducts?.length}
          {#each sellerProducts as prod}
            <tr>
              <td>{prod.id}</td>
              <td>{new Date(prod.createdate).toLocaleString("ru-RU")}</td>
              <td>
                <a href={`#/store/product/${prod.id}`}>
                  {prod.title}
                </a>
              </td>
              <td>
                {#if prod.type === "physical"}
                  <span title="Физическая копия" style="cursor:default">💿</span
                  >
                {:else}
                  <span title="Цифровая копия" style="cursor:default">⬇️</span>
                {/if}
              </td>
              <td class="active">{prod.price}</td>
              <td>
                <details class="dropdown" bind:this={dropdowns[prod.id]}>
                  <summary>...</summary>
                  <ul>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <li on:click={() => openEditProductModal(prod)}>
                      📝 Редактировать
                    </li>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <li>🔑 Проверить лицензии</li>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
  .active {
    color: var(--pico-primary);
    font-weight: 200;
  }
  .title-one-line {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
  .new-product-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .new-product-overlay .modal {
    background: var(--pico-background-color);
    padding: 24px;
    border-radius: 12px;
    width: 50vw;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  }

  .new-product-overlay input[type="text"] {
    width: 100%;
    padding: 8px;
    margin: 12px 0;
    font-size: 1rem;
  }

  .new-product-overlay .buttons {
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
