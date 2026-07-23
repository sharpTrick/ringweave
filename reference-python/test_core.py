"""Stage 1: trust the metrics before building anything on them."""
import math
from core import (
    Graph, ring, all_pairs_summary, girth, moore_lower_bounds,
    cycle_aspl, is_connected, largest_component_fraction,
)


def approx(a, b, tol=1e-9):
    return abs(a - b) < tol


def test_cycle_aspl_formula():
    # Compare BFS ASPL against closed form for several n
    for n in [5, 6, 7, 8, 10, 11, 20, 21]:
        g = ring(n)
        aspl, diam, conn = all_pairs_summary(g)
        formula = cycle_aspl(n)
        assert conn, f"C_{n} should be connected"
        assert approx(aspl, formula), f"C_{n}: BFS {aspl} vs formula {formula}"
        assert diam == n // 2, f"C_{n}: diameter {diam} expected {n//2}"
        assert girth(g) == n, f"C_{n}: girth {girth(g)} expected {n}"
    print("  cycle ASPL/diameter/girth ......... OK")


def petersen():
    """Standard Petersen graph, 10 vertices, 3-regular."""
    g = Graph(10)
    # outer pentagon 0-4, inner pentagram 5-9
    for i in range(5):
        g.add_edge(i, (i + 1) % 5)          # outer cycle
        g.add_edge(i, i + 5)                 # spokes
        g.add_edge(5 + i, 5 + (i + 2) % 5)   # inner pentagram
    return g


def test_petersen():
    g = petersen()
    assert all(g.degree(v) == 3 for v in range(10)), "Petersen must be 3-regular"
    aspl, diam, conn = all_pairs_summary(g)
    assert conn
    assert diam == 2, f"Petersen diameter {diam} expected 2"
    assert approx(aspl, 5 / 3), f"Petersen ASPL {aspl} expected {5/3}"
    assert girth(g) == 5, f"Petersen girth {girth(g)} expected 5"
    print("  Petersen (diam 2, girth 5, ASPL 5/3) OK")


def test_complete_graph():
    for n in [4, 5, 8]:
        g = Graph(n)
        for i in range(n):
            for j in range(i + 1, n):
                g.add_edge(i, j)
        aspl, diam, conn = all_pairs_summary(g)
        assert approx(aspl, 1.0), f"K_{n} ASPL {aspl} expected 1"
        assert diam == 1
        assert girth(g) == 3
    print("  complete graph K_n (ASPL 1) ....... OK")


def test_moore_bounds():
    # Petersen is a Moore graph: it MEETS the bound (diam 2, k=3, n=10).
    aspl_lb, diam_lb = moore_lower_bounds(10, 3)
    assert diam_lb == 2, f"Moore diam_lb {diam_lb} expected 2 for (10,3)"
    # shells: 3 at dist1, 6 at dist2 -> exactly 9 = n-1, ASPL_lb = (3+12)/9 = 5/3
    assert approx(aspl_lb, 5 / 3), f"Moore aspl_lb {aspl_lb} expected 5/3"
    # A real Petersen must not beat its own lower bound
    g = petersen()
    aspl, _, _ = all_pairs_summary(g)
    assert aspl >= aspl_lb - 1e-9
    assert approx(aspl, aspl_lb), "Petersen should exactly meet Moore bound"
    print("  Moore bound meets Petersen ........ OK")


def test_disconnect_detection():
    g = Graph(6)
    g.add_edge(0, 1); g.add_edge(1, 2); g.add_edge(0, 2)
    g.add_edge(3, 4); g.add_edge(4, 5); g.add_edge(3, 5)
    assert not is_connected(g)
    assert approx(largest_component_fraction(g), 0.5)
    print("  disconnection detection ........... OK")


def test_girth_acyclic():
    # a path/tree has no cycle
    g = Graph(4)
    g.add_edge(0, 1); g.add_edge(1, 2); g.add_edge(2, 3)
    assert girth(g) == math.inf
    print("  girth of tree is infinite ......... OK")


if __name__ == "__main__":
    print("Stage 1 trust tests:")
    test_cycle_aspl_formula()
    test_petersen()
    test_complete_graph()
    test_moore_bounds()
    test_disconnect_detection()
    test_girth_acyclic()
    print("ALL PASS")
