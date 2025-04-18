<script>
  import NavMenu from "../components/NavMenu.svelte";
  import { params, push } from "svelte-spa-router";
  import { fade, fly } from "svelte/transition";
  import { accessToken } from "../stores/auth";
  import { apiFetch } from "../lib/apiFetch";
  import { v4 as uuidv4 } from "uuid";

  let productInfo;
  let sellerInfo;
  let userOwnedProducts;
  let newOrderUuid = uuidv4();
  let isPurchaseBtnLocked = false;
  let isPurchaseBtnLoading = false;

  $: if ($params?.id) {
    setProductInfo();
  }

  async function setProductInfo() {
    const query = await apiFetch(`api/store/v1/products/${$params.id}`);
    if (query.status === 401) {
      push("/login");
      return;
    }
    if (query.status === 404) {
      push("/notfound");
      return;
    }
    await setUserOwnedProducts();
    productInfo = await query.json();
    setSellerInfo();
  }

  async function setSellerInfo() {
    if (!productInfo?.sellerid) {
      return;
    }
    const query = await apiFetch(`api/users/v1/users/${productInfo.sellerid}`);
    if (query.ok) {
      sellerInfo = await query.json();
    }
  }

  async function setUserOwnedProducts() {
    userOwnedProducts = await apiFetch("api/library/v1/products").then((res) =>
      res.json()
    );
  }

  function getPriceBtnText(productId, price) {
    if (isPurchaseBtnLocked) {
      return "Заказ оформлен";
    }
    return userOwnedProducts?.some(
      (prod) => Number(prod.productid) === Number(productId)
    )
      ? "Приобретено"
      : `${price} ₽`;
  }

  function getPriceBtnClass(productId) {
    return userOwnedProducts?.some(
      (prod) => Number(prod.productid) === Number(productId)
    )
      ? "contrast"
      : "primary";
  }

  async function onPurchaseBtnClick() {
    if (
      isPurchaseBtnLocked ||
      userOwnedProducts?.some(
        (prod) => Number(prod.productid) === productInfo?.id
      )
    ) {
      return;
    }
    isPurchaseBtnLoading = true;
    const newOrder = await apiFetch("api/orders/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productid: productInfo?.id,
        requestId: newOrderUuid,
      }),
    });
    if (newOrder.ok) {
      isPurchaseBtnLoading = false;
      isPurchaseBtnLocked = true;
    }
    isPurchaseBtnLoading = false;
  }
</script>

<main class="blocks-container">
  <NavMenu />
  {#if productInfo}
    <article in:fade>
      <div class="title">
        <div>
          <h2>{productInfo.title}</h2>
          {#if sellerInfo}
            <div class="highlight">
              {sellerInfo.name}
              {sellerInfo.surname} ({sellerInfo.nickname})
            </div>
          {/if}
          <div class="details">
            {productInfo.type === "digital"
              ? "Цифровая лицензия"
              : "Физическая копия"}
          </div>
        </div>
        <div>
          <button
            disabled={isPurchaseBtnLocked}
            aria-busy={isPurchaseBtnLoading}
            aria-label="Заказ оформляется..."
            class={getPriceBtnClass(productInfo.id)}
            on:click={onPurchaseBtnClick}
          >
            {getPriceBtnText(productInfo.id, productInfo.price)}
          </button>
        </div>
      </div>
    </article>
    <article in:fade>
      <h4>Описание</h4>
      {productInfo.description}
    </article>
    <article in:fade>
      <h4>Системные требования</h4>
      {productInfo.systemrequirements}
    </article>
    <article in:fade class="details">
      Дата публикации: {new Date(productInfo.createdate).toLocaleDateString(
        "ru-RU"
      )}
    </article>
  {/if}
</main>

<style>
  .blocks-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    align-items: center;
    justify-content: start;
    margin: 64px 0;
    padding: 0 78px;
  }
  .blocks-container > * {
    width: 100%;
    margin: 0;
  }
  .blocks-container h4,
  .blocks-container .highlight {
    color: var(--pico-primary);
  }
  .blocks-container .details {
    color: var(--pico-secondary);
  }
  article > div {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    flex-wrap: nowrap;
  }
</style>
