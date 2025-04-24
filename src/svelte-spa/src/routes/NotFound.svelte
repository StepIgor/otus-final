<div class="container">
  <span class="code">404</span>
  <span class="title">Страница не найдена</span>
  <span class="description">
    Что ж, и такое бывает! Предлагаем вернуться
    <a href="#/account"> на страницу своего аккаунта</a>
  </span>
  <span class="details">svelte-spa-router: path not found</span>
</div>

<style>
  .container {
    display: flex;
    width: 100%;
    padding-top: 128px;
    flex-direction: column;
    gap: 24px;
    align-items: center;
    justify-content: center;
  }
  .code {
    font-weight: 200;
    font-size: 96px;
    color: var(--pico-primary);
  }
  .title {
    font-weight: bold;
  }
  .details {
    color: var(--pico-secondary);
    font-size: 12px;
    font-style: italic;
  }
</style>
