<script>
  import { push } from "svelte-spa-router";
</script>

<main>
  <div class="header">
    <span class="title">
      Онлайн-сервис приобретения цифровых и физических копий ПО
    </span>
    <span class="subtitle">
      Все лицензии на цифровое ПО и заказы на доставку физических копий в одном
      аккаунте
    </span>
    <button class="acc-btn" on:click={() => push("/login")}>
      Войти в аккаунт
    </button>
    <a href="#/register">Завести новый аккаунт</a>
  </div>
</main>

<style>
  .header {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 16px;
    justify-content: center;
    align-items: center;
    margin-top: 25vh;
  }

  .title {
    font-size: 48px;
    font-weight: bold;
    color: var(--pico-primary);
    text-align: center;
  }

  .subtitle {
    font-size: 24px;
    color: var(--pico-secondary);
  }

  .acc-btn {
    margin-top: 64px;
  }

  .header > a {
    color: var(--pico-secondary);
    text-decoration: none;
  }
</style>
