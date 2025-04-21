<script>
    import Router from 'svelte-spa-router';
  
    import Index from './routes/Index.svelte';
    import Login from './routes/Login.svelte';
    import Register from './routes/Register.svelte';
    import Account from './routes/Account.svelte';
    import NotFound from './routes/NotFound.svelte';
    import Store from './routes/Store.svelte';
    import Product from './routes/Product.svelte';
    import Library from './routes/Library.svelte';
    import Seller from './routes/Seller.svelte';
  
    const routes = {
      '/': Index,
      '/login': Login,
      '/register': Register,
      '/account': Account,
      '/store': Store,
      '/store/product/:id': Product,
      '/library': Library,
      '/seller': Seller,
      '*': NotFound
    };
  </script>
  
  <main>
    <Router {routes}  />
  </main>
  