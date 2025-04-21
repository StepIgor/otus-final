<script>
  import NavMenu from "../components/NavMenu.svelte";
  import { onMount } from "svelte";
  import { apiFetch } from "../lib/apiFetch";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { accessToken } from "../stores/auth";

  onMount(() => {
    setUserOwnedProducts();
  });

  let userOwnedProducts;
  let detailedInfoProductId;
  $: chosenProductInfo = userOwnedProducts?.find(
    (prod) => prod.id === detailedInfoProductId
  );

  async function setUserOwnedProducts() {
    const query = await apiFetch("api/library/v1/products");
    if (query.status === 401) {
      accessToken.set(null);
      push("/login");
    }
    userOwnedProducts = await query.json();
    userOwnedProducts = await Promise.all(
      userOwnedProducts.map(async (prod) => {
        const productStoreInfo = await apiFetch(
          `api/store/v1/products/${prod.productid}`
        ).then((res) => res.json());
        return { ...prod, ...productStoreInfo };
      })
    ).then((res) => res.toSorted((a, b) => a.title?.localeCompare(b.title)));
  }
</script>

<main class="blocks-container">
  <NavMenu />
  <div class="library-container">
    <div class="lib-list">
      <article>
        <table class="striped">
          <thead>
            <tr>
              <td class="list-header">
                Ваша библиотека ({userOwnedProducts?.length || 0})
              </td>
            </tr>
          </thead>
          <tbody>
            {#if userOwnedProducts?.length}
              {#each userOwnedProducts as prod}
                <tr
                  class="list-item"
                  on:click={() => (detailedInfoProductId = prod.id)}
                >
                  <td class:active={prod.id === detailedInfoProductId}>
                    {prod.type === "physical" ? "💿" : ""}
                    {prod.title}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </article>
    </div>
    <div class="lib-details">
      <article>
        {#if detailedInfoProductId}
          <div class="prod-detail-container">
            <div class="prod-detail-header">
              <h3>{chosenProductInfo.title}</h3>
              <div>
                <details class="dropdown">
                  <summary role="button" class="outline secondary">
                    ...
                  </summary>
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                  <ul
                    on:click={() =>
                      push(`/store/product/${chosenProductInfo.id}`)}
                  >
                    Открыть в магазине
                  </ul>
                </details>
                {#if chosenProductInfo.type === "digital"}
                  <button>Запустить</button>
                {:else}
                  <details class="dropdown">
                    <summary role="button" class="secondary"> Показать ключ </summary>
                    <ul>
                      {chosenProductInfo.licenseid}
                    </ul>
                  </details>
                {/if}
              </div>
            </div>
            <div class="prod-detail-description">
              {chosenProductInfo.description}
            </div>
          </div>
        {:else}
          <div class="choose-prod-info">Выберите продукт из списка слева</div>
        {/if}
      </article>
    </div>
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
  .library-container {
    display: flex;
    flex-direction: row;
    gap: 32px;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0 78px;
    height: 70vh;
  }
  .lib-list {
    min-width: 300px;
    height: 100%;
  }
  .list-header,
  .active {
    color: var(--pico-primary);
  }
  .lib-details {
    flex-grow: 1;
    height: 100%;
  }
  article {
    display: block;
    height: 100%;
    padding: 0;
    overflow-y: auto;
    border: 1px solid var(--pico-primary);
  }
  .list-item {
    cursor: pointer;
  }
  .list-item:hover > td,
  .prod-detail-header > div > details > ul:hover {
    color: var(--pico-primary);
  }
  .choose-prod-info {
    padding: 16px;
  }
  .prod-detail-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    justify-content: start;
    align-items: start;
    padding: 16px;
    width: 100%;
  }
  .prod-detail-header {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    flex-wrap: nowrap;
    width: 100%;
  }
  .prod-detail-header > div {
    display: flex;
    flex-direction: row;
    gap: 0;
    align-items: center;
    flex-wrap: nowrap;
    justify-content: center;
  }
  .prod-detail-header > div > details {
    margin: 0;
  }
  .prod-detail-header > div > details > ul {
    cursor: pointer;
    padding: 4px;
  }
</style>
