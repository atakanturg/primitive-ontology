import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { Home } from './pages/Home';
import { Target } from './pages/Target';
import { Data } from './pages/Data';
import { Signals } from './pages/Signals';
import { Screener } from './pages/Screener';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="target" element={<Target />} />
        <Route path="data" element={<Data />} />
        <Route path="signals" element={<Signals />} />
        <Route path="screener" element={<Screener />} />
      </Route>
    </Routes>
  );
}
