"""LAMA Slicer in the browser only: robust geometry overlays.

Pyodide's shapely is built on GEOS 3.12.1 (the desktop app uses a newer GEOS). On some sections of the
modules its floating-point overlay throws a TopologyException ("found non-noded intersection"), and in the
browser build that C++ exception cannot be caught: it stops the Python engine. With a grid_size, GEOS uses
snap-rounding noding, which cannot fail this way. 1e-6 mm is far below anything a printer can show, so the
toolpaths stay the same; the weave scripts themselves are not changed.
"""
import shapely

GRID = 1e-6


def _robust(fn):
    def call(*args, grid_size=None, **kwargs):
        return fn(*args, grid_size=GRID if grid_size is None else grid_size, **kwargs)
    call.__name__, call.__doc__, call.__wrapped__ = fn.__name__, fn.__doc__, fn
    return call


for _n in ('union', 'intersection', 'difference', 'symmetric_difference', 'union_all'):
    setattr(shapely, _n, _robust(getattr(shapely, _n)))
