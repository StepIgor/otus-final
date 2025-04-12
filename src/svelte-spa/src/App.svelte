<script>
    import Router from 'svelte-spa-router';
  
    import Index from './routes/Index.svelte';
    import Login from './routes/Login.svelte';
    import Register from './routes/Register.svelte';
    import Account from './routes/Account.svelte';
    import NotFound from './routes/NotFound.svelte';
    import Store from './routes/Store.svelte';
  
    const routes = {
      '/': Index,
      '/login': Login,
      '/register': Register,
      '/account': Account,
      '/store': Store,
      '*': NotFound
    };
  </script>
  
  <main>
    <Router {routes}  />
  </main>
  