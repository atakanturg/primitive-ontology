import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { Home } from './pages/Home';
import { Target } from './pages/Target';
import { Data } from './pages/Data';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="target" element={<Target />} />
        <Route path="data" element={<Data />} />
      </Route>
    </Routes>
  );
}
