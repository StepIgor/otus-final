<script>
  import NavMenu from "../components/NavMenu.svelte";
  import { params, push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import { accessToken, userLogin } from "../stores/auth";
  import { apiFetch } from "../lib/apiFetch";
  import { v4 as uuidv4 } from "uuid";

  let userId;
  let userInfo;
  let myFriends = [];
  let userFriends = [];
  let userProducts = [];

  let isUserMyFriend = false;
  let isItMe = false;

  let isFriendBtnDisabled = false;
  let friendBtnCustomText = "";

  $: if ($params?.userid) {
    setAllInfo();
  }

  async function setAllInfo() {
    userId = $params.userid;
    await Promise.all([setUserInfo(userId), setMyFriends()]);
    isItMe = userInfo?.nickname === $userLogin;
    isUserMyFriend = myFriends?.some(
      (friend) => friend.friendid === userInfo?.id
    );
    setUserFriends();
    setUserProducts();
  }

  async function setUserInfo(userId) {
    const query = await apiFetch(`api/users/v1/users/${userId}`);
    if (query.status === 401) {
      push("/login");
      return;
    }
    if (query.status === 404) {
      push("/usernotfound");
      return;
    }
    userInfo = await query.json();
  }

  async function setMyFriends() {
    myFriends = await apiFetch("api/social/v1/friends").then((res) =>
      res.json()
    );
  }

  async function setUserFriends() {
    userFriends = await apiFetch(`api/social/v1/friends/${userInfo?.id}`)
      .then((res) => res.json())
      .then((friends) =>
        Promise.all(
          friends.map(async (friend) => {
            const friendInfo = await apiFetch(
              `api/users/v1/users/${friend.friendid}`
            ).then((res) => res.json());
            return { ...friend, ...friendInfo };
          })
        )
      );
  }

  async function setUserProducts() {
    if (userInfo?.rolename !== "seller") {
      userProducts = [];
      return;
    }
    userProducts = await apiFetch(
      `api/store/v1/products/seller/${userInfo?.id}`
    ).then((res) => res.json());
  }

  async function onFriendBtnClick(friendId) {
    if (isItMe || isFriendBtnDisabled) {
      return;
    }
    if (isUserMyFriend) {
      await apiFetch(`api/social/v1/friends/${friendId}`, { method: "DELETE" });
      setMyFriends();
      setUserFriends();
      isUserMyFriend = false;
      return;
    }
    await apiFetch(`api/social/v1/friends/${friendId}`, { method: "POST" });
    isFriendBtnDisabled = true;
    friendBtnCustomText = "Заявка отправлена";
  }
</script>

<main class="blocks-container">
  <NavMenu />
  <div in:fade class="block">
    <article class="user-info-block">
      <div>
        <h4>{userInfo?.nickname}</h4>
        <div class="user-fullname">{userInfo?.name} {userInfo?.surname}</div>
        <div class="user-details">
          <a href={`mailto:${userInfo?.email}`}>{userInfo?.email}</a>,
          <span>{userInfo?.rolename}</span>
        </div>
      </div>
      <div>
        <button
          class:outline={isItMe || isUserMyFriend}
          disabled={isFriendBtnDisabled || isItMe}
          class:delete={isUserMyFriend}
          on:click={() => onFriendBtnClick(userInfo?.id)}
        >
          {#if friendBtnCustomText}
            <span>{friendBtnCustomText}</span>
          {:else if isItMe}
            <span>Ваша страница</span>
          {:else if isUserMyFriend}
            <span>Удалить из друзей</span>
          {:else}
            <span>Добавить в друзья</span>
          {/if}
        </button>
      </div>
    </article>
    {#if userInfo?.rolename === "seller"}
      <article class="products-info-block">
        <h6>Опубликованные товары в магазине ({userProducts?.length || 0})</h6>
        {#if userProducts?.length}
          <div class="products-blocks">
            {#each userProducts as product}
              <div class="product-block">
                <a href={`#/store/product/${product.id}`} class="product-title">
                  {product.title}
                </a>
              </div>
            {/each}
          </div>
        {:else}
          Здесь пока что пусто
        {/if}
      </article>
    {/if}
    <article class="friends-info-block">
      <h6>Список друзей ({userFriends?.length || 0})</h6>
      {#if userFriends?.length}
        <div class="friend-blocks">
          {#each userFriends as friend}
            <div class="friend-block">
              <a href={`#/community/user/${friend.id}`} class="friend-nickname">
                {friend.nickname}
              </a>
              <span class="friend-fullname">
                {friend.name}
                {friend.surname}
              </span>
              <span class="friend-rolename">{friend.rolename}</span>
            </div>
          {/each}
        </div>
      {:else}
        <span class="no-friends-hint">
          Кажется, {userInfo?.nickname} ни с кем не дружит
        </span>
      {/if}
    </article>
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
  .user-info-block {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    flex-wrap: nowrap;
  }
  .block > article {
    margin-bottom: 24px;
  }
  h4 {
    color: var(--pico-primary);
  }
  .user-fullname {
    font-weight: 100;
  }
  .user-details {
    font-size: 14px;
    color: var(--pico-secondary);
  }
  .delete {
    color: var(--pico-del-color);
    border-color: var(--pico-del-color);
  }
  .products-blocks {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 16px;
  }
  .product-block {
    display: flex;
    flex-direction: column;
    justify-content: start;
    align-items: center;
    gap: 4px;
    border-radius: 4px;
    border: 1px solid var(--pico-primary);
    padding: 8px;
  }
  .product-title {
    font-weight: bold;
  }
  .friend-blocks {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 16px;
  }
  .friend-block {
    display: flex;
    flex-direction: column;
    justify-content: start;
    align-items: center;
    gap: 4px;
    border-radius: 4px;
    border: 1px solid var(--pico-primary);
    padding: 8px;
  }
  .friend-nickname {
    font-weight: bold;
  }
  .friend-fullname {
    font-weight: 100;
  }
  .friend-rolename {
    font-size: 10px;
    color: var(--pico-secodary);
    font-weight: normal;
  }
  .no-friends-hint {
    font-size: 16px;
    font-weight: 200;
    color: var(--pico-secodary);
    font-style: italic;
  }
</style>
