import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { Home } from './pages/Home';
import { Signals } from './pages/Signals';
import { Screener } from './pages/Screener';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="signals" element={<Signals />} />
        <Route path="screener" element={<Screener />} />
        {/* Legacy redirects */}
        <Route path="target" element={<Signals />} />
        <Route path="data" element={<Signals />} />
      </Route>
    </Routes>
  );
}
