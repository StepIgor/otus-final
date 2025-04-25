<script>
  import { onMount } from "svelte";
  import { userLogin } from "../stores/auth";
  import { apiFetch } from "../lib/apiFetch";
  import { push } from "svelte-spa-router";
  import { fade } from "svelte/transition";
  import NavMenu from "../components/NavMenu.svelte";

  let friends = [];
  let requests = [];

  onMount(() => {
    setFriends();
    setRequests();
  });

  async function setFriends() {
    const query = await apiFetch("api/social/v1/friends");
    if (query.status === 401) {
      push("/login");
      return;
    }
    friends = await query.json().then((res) =>
      Promise.all(
        res.map(async (friend) => {
          const friendInfo = await apiFetch(
            `api/users/v1/users/${friend.friendid}`
          ).then((res) => res.json());
          return { ...friend, ...friendInfo };
        })
      )
    );
  }

  async function setRequests() {
    const query = await apiFetch("api/social/v1/friends/requests");
    requests = await query.json().then((res) =>
      Promise.all(
        res.map(async (request) => {
          const userInfo = await apiFetch(
            `api/users/v1/users/${request.from_user}`
          ).then((res) => res.json());
          return { ...request, ...userInfo };
        })
      )
    );
  }

  async function acceptRequest(userId) {
    await apiFetch(`api/social/v1/friends/approve/${userId}`, {
      method: "POST",
    });
    setRequests();
    setFriends();
  }

  async function denyRequest(userId) {
    await apiFetch(`api/social/v1/friends/${userId}`, {
      method: "DELETE",
    });
    setRequests();
  }
</script>

<main class="blocks-container">
  <NavMenu />
  <div in:fade class="block">
    <span>Добро пожаловать, {$userLogin}!</span>
    <div>
      Участвуйте в жизни сообщества, размещая, комментируя публикации,
      посвящённые продуктам, зарегистрированным на платформе. Взаимодействуйте,
      общайтесь с другими участниками, находя общие интересы
    </div>
    <article>
      <h5>Список ваших друзей ({friends?.length || 0})</h5>
      {#if friends?.length}
        <div class="friend-blocks">
          {#each friends as friend}
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
        Ваш список пока что пуст
      {/if}
    </article>
    <article>
      <h6>Заявки на добавление в друзья ({requests.length || 0})</h6>
      {#if requests?.length}
        <div class="friend-blocks">
          {#each requests as request}
            <div class="friend-block">
              <a
                href={`#/community/user/${request.id}`}
                class="friend-nickname"
              >
                {request.nickname}
              </a>
              <span class="friend-fullname">
                {request.name}
                {request.surname}
              </span>
              <div>
                <button
                  class="outline primary"
                  on:click={() => acceptRequest(request.id)}>✅</button
                >
                <button
                  class="outline secondary"
                  on:click={() => denyRequest(request.id)}>🚫</button
                >
              </div>
            </div>
          {/each}
        </div>
      {:else}
        Заявок нет
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
  .block > span {
    font-size: 36px;
    color: #ffffff;
    font-weight: 100;
  }
  .block > div {
    font-weight: 100;
    text-align: justify;
  }
  .block > article {
    margin: 24px 0;
  }
  article > h5 {
    color: var(--pico-primary);
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
</style>
