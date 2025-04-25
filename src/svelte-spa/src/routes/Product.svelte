<script>
  import NavMenu from "../components/NavMenu.svelte";
  import { params, push } from "svelte-spa-router";
  import { fade, fly } from "svelte/transition";
  import { accessToken } from "../stores/auth";
  import { apiFetch } from "../lib/apiFetch";
  import { v4 as uuidv4 } from "uuid";

  let productInfo;
  let sellerInfo;
  let [reviews, reviewStats, myReview] = [[], null, null];
  let userOwnedProducts;
  let newOrderUuid = uuidv4();
  let isPurchaseBtnLocked = false;
  let isPurchaseBtnLoading = false;

  let isNewReviewModalOpened = false;
  let [newReviewRecommends, newReviewText] = [true, ""];
  let newReviewErrorText = "";

  let hasUserPurchasedProduct = false;

  $: if ($params?.productid) {
    setProductInfo();
  }

  async function setProductInfo() {
    const query = await apiFetch(`api/store/v1/products/${$params.productid}`);
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
    setReviews($params.productid);
    setReviewStats($params.productid);
    setMyReview($params.productid);
    hasUserPurchasedProduct = userOwnedProducts?.some(
      (prod) => Number(prod.productid) === Number($params.productid)
    );
  }

  async function setReviews(productId) {
    reviews = await apiFetch(`api/social/v1/reviews/${productId}`)
      .then((res) => res.json())
      .then((res) =>
        Promise.all(
          res.map(async (review) => ({
            ...review,
            userInfo: await apiFetch(
              `api/users/v1/users/${review.userid}`
            ).then((res) => res.json()),
          }))
        )
      );
  }
  async function setReviewStats(productId) {
    reviewStats = await apiFetch(
      `api/social/v1/reviews/${productId}/stats`
    ).then((res) => res.json());
  }
  async function setMyReview(productId) {
    myReview = await apiFetch(`api/social/v1/reviews/${productId}/my`).then(
      (res) => res.json()
    );
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

  async function onPurchaseBtnClick(productId) {
    if (
      isPurchaseBtnLocked ||
      userOwnedProducts?.some((prod) => Number(prod.productid) === productId)
    ) {
      return;
    }
    isPurchaseBtnLoading = true;
    const newOrder = await apiFetch("api/orders/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productid: productId,
        requestId: newOrderUuid,
      }),
    });
    if (newOrder.ok) {
      isPurchaseBtnLoading = false;
      isPurchaseBtnLocked = true;
    }
    isPurchaseBtnLoading = false;
  }

  function closeNewReviewModal() {
    isNewReviewModalOpened = false;
  }
  function openNewReviewModal() {
    newReviewRecommends = true;
    newReviewText = "";
    newReviewErrorText = "";
    isNewReviewModalOpened = true;
  }

  async function submitNewReview() {
    if (!newReviewText?.trim()) {
      newReviewErrorText = "Проверьте заполнение всех полей";
      return;
    }
    const query = await apiFetch("api/social/v1/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productid: $params.productid,
        recommends: newReviewRecommends,
        text: newReviewText,
      }),
    });
    if (!query.ok) {
      newReviewErrorText = await query.text();
      return;
    }
    setReviews($params.productid);
    setMyReview($params.productid);
    setReviewStats($params.productid);
    closeNewReviewModal();
  }
</script>

{#if isNewReviewModalOpened}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    in:fade
    out:fade
    class="modal-overlay"
    on:click|self={closeNewReviewModal}
  >
    <div class="modal">
      <h2>Опубликовать отзыв к {productInfo?.title || "продукту"}</h2>
      <label>
        <input type="checkbox" bind:checked={newReviewRecommends} />
        Рекомендую
      </label>

      <textarea
        bind:value={newReviewText}
        maxlength="4096"
        placeholder="Текст отзыва"
      ></textarea>
      {#if newReviewErrorText}
        <span class="error">{newReviewErrorText}</span>
      {/if}
      <div class="buttons">
        <button on:click={submitNewReview}>Опубликовать</button>
        <button class="outline secondary" on:click={closeNewReviewModal}>
          Отмена
        </button>
      </div>
    </div>
  </div>
{/if}

<main class="blocks-container">
  <NavMenu />
  {#if productInfo}
    <article in:fade>
      <div class="title">
        <div>
          <h2>{productInfo.title}</h2>
          {#if sellerInfo}
            <a class="highlight" href={`#/community/user/${sellerInfo.id}`}>
              {sellerInfo.name}
              {sellerInfo.surname} ({sellerInfo.nickname})
            </a>
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
            on:click={() => onPurchaseBtnClick(productInfo.id)}
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
    <article in:fade>
      <h4>Оценки ({reviews?.length || 0} всего)</h4>
      📊
      {reviewStats?.recommend || 0} положительных,
      {reviewStats?.not_recommend || 0} отрицательных
    </article>
    {#if myReview?.review?.text}
      <article in:fade>
        <h4>
          Мой отзыв от
          {new Date(myReview?.review?.createdate).toLocaleDateString("ru-RU")}
        </h4>
        <div>
          {myReview?.review?.recommends ? "👍🏻 Рекомендую" : "👎🏻 Не рекомендую"}
        </div>
        <div>
          {myReview?.review?.text}
        </div>
      </article>
    {:else if hasUserPurchasedProduct}
      <article in:fade>
        <h4>Мой отзыв</h4>
        <button on:click={openNewReviewModal}>
          Опубликовать отзыв к продукту
        </button>
      </article>
    {/if}
    <article in:fade>
      <h4>Отзывы ({reviews?.length || 0} всего)</h4>
      {#if reviews?.length}
        {#each reviews as review}
          <div class="review">
            <div>
              🙂 <a href={`#/community/user/${review.userInfo?.id}`}>
                {review.userInfo?.nickname || "unknown"}
              </a>
              <span
                class:recommends={review.recommends}
                class:not_recommends={!review.recommends}
              >
                {review.recommends ? "рекомендует" : "не рекомендует"}
              </span>
              <span class="secondary-text">
                ({new Date(review.createdate).toLocaleDateString("ru-RU")})
              </span>
            </div>
            <div>
              {review.text}
            </div>
          </div>
        {/each}
      {:else}
        <span>Нет ни одного опубликованного отзыва к продукту</span>
      {/if}
    </article>
    <article in:fade class="details">
      Дата публикации:
      {new Date(productInfo.createdate).toLocaleDateString("ru-RU")}
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
  .blocks-container .details,
  .secondary-text {
    color: var(--pico-secondary);
  }
  article > div {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    flex-wrap: nowrap;
  }
  .recommends {
    color: green;
  }
  .not_recommends {
    color: orangered;
  }
  .review {
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
    justify-content: start;
    align-items: start;
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
