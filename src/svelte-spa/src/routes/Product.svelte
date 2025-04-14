<script>
  import NavMenu from "../components/NavMenu.svelte";
  import { params, push } from "svelte-spa-router";
  import { fade, fly } from "svelte/transition";
  import { accessToken } from "../stores/auth";
  import { apiFetch } from "../lib/apiFetch";

  let productInfo;
  let sellerInfo;

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
        <div><button>{productInfo.price} ₽</button></div>
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
