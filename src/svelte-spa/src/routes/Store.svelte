<script>
  import NavMenu from "../components/NavMenu.svelte";
  import { onMount } from "svelte";
  import { apiFetch } from "../lib/apiFetch";
  import { push } from "svelte-spa-router";
  import { fade, fly } from "svelte/transition";
  import { accessToken } from "../stores/auth";

  onMount(() => {
    setProducts();
  });

  let products = [];
  let search = "";
  let minPrice;
  let maxPrice;
  let [physical, digital] = [true, true];

  async function setProducts() {
    const uriParams = new URLSearchParams();
    uriParams.set("search", search);
    uriParams.set("minPrice", minPrice || "");
    uriParams.set("maxPrice", maxPrice || "");
    if (physical === digital) {
      uriParams.set("type", "");
    } else if (digital) {
      uriParams.set("type", "digital");
    } else {
      uriParams.set("type", "physical");
    }

    const query = await apiFetch(
      `api/store/v1/products?${uriParams.toString()}`
    );
    if (query.status === 401) {
      accessToken.set(null);
      push("/login");
    }
    products = await query.json();
  }
</script>

<main class="blocks-container">
  <NavMenu />
  <div in:fade class="filters-container">
    <input
      type="text"
      maxlength="32"
      bind:value={search}
      placeholder="Поиск по названию/описанию"
      on:change={setProducts}
    />
    <input
      type="number"
      bind:value={minPrice}
      placeholder="Мин. цена"
      on:change={setProducts}
    />
    <input
      type="number"
      bind:value={maxPrice}
      placeholder="Макс. цена"
      on:change={setProducts}
    />
    <label>
      <input type="checkbox" bind:checked={digital} on:change={setProducts} />
      Цифровая версия
    </label>
    <label>
      <input type="checkbox" bind:checked={physical} on:change={setProducts} />
      Физическая копия
    </label>
  </div>
  <span>Найдено результатов: {products?.length || 0}</span>
  <div class="products-container">
    {#each products as prod}
      <article class="prod-tile">
        <h3>{prod.title}</h3>
        <div>{prod.description}</div>
        <button on:click={() => push(`/store/product/${prod.id}`)}>
          {prod.price} ₽
        </button>
      </article>
    {/each}
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
  .filters-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: start;
    width: 100%;
    padding: 0 78px;
    gap: 16px;
  }
  .products-container {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    width: 100%;
    padding: 0 78px;
  }
  .prod-tile h3 {
    color: var(--pico-primary);
  }
  .prod-tile {
    display: flex;
    justify-content: space-between;
    flex-direction: column;
  }
  .prod-tile > button {
    margin-top: 24px;
  }
  .filters-container > input[type="text"] {
    width: 350px;
  }
  .filters-container > input[type="number"] {
    width: 200px;
  }
</style>
