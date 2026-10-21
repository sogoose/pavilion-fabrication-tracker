"""LAMA web adapter: automatically find a valid reference section for the original N1/N2 weave.

Does not alter the weave pattern or bypass its 1 triangular + 3 circular holes requirement.
"""

_lama_original_run_mesh = run_mesh


def _lama_reference_heights(mesh, config):
    units = float(config['MODEL_UNITS_TO_MM'])
    zmin = float(mesh.bounds[0][2])
    zmax = float(mesh.bounds[1][2])
    dz = zmax - zmin
    start = zmin + 0.5 * float(config['FIRST_LAYER_HEIGHT']) / units
    step = float(config['FIRST_LAYER_HEIGHT']) / units
    samples = [start]
    samples += [start + i * step for i in range(1, 13)]
    samples += [zmin + dz * a for a in
                (0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95)]
    result = []
    seen = set()
    for z in samples:
        if z <= zmin + 1e-7 or z >= zmax - 1e-7:
            continue
        key = round(z, 4)
        if key not in seen:
            seen.add(key)
            result.append(z)
    return result


def run_mesh(tm, S):
    # Respect an explicit reference layer rather than silently overriding it.
    if S.get('REFERENCE_Z') is not None:
        return _lama_original_run_mesh(tm, S)

    observations = []
    for z in _lama_reference_heights(tm, S):
        try:
            section = section_polygon(tm, z)
            openings = len(section.interiors)
            observations.append((z, openings))
            if openings != 4:
                continue
            # The original geometry classifier still decides whether the
            # three openings are circular and the fourth is triangular.
            from shapely.geometry import Polygon
            loops = [Polygon(section.exterior)] + [Polygon(h) for h in section.interiors]
            try:
                classify(loops)
            except ValueError:
                continue
            settings = dict(S, REFERENCE_Z=z)
            result = _lama_original_run_mesh(tm, settings)
            first = observations[0]
            if abs(z - first[0]) > 1e-5:
                message = ('Reference auto-detection: first section z=%.2f mm has %d openings; '
                           'using compatible four-opening section at z=%.2f mm.' %
                           (first[0], first[1], z))
                print(message)
                result[0]['log'].insert(0, message)
            return result
        except (ValueError, TypeError, AttributeError):
            observations.append((z, 'section error'))
            continue

    first = observations[0] if observations else (float(tm.bounds[0][2]), 'none')
    summary = ', '.join('z=%.1f:%s' % (z, n) for z, n in observations[:10])
    raise ValueError(
        'This STL is not compatible with the original N1/N2 weave reference: '
        'needs one outline, one triangular opening and three circular openings '
        '(four internal openings total). At z=%.2f mm it has %s openings. '
        'Searched %d section heights; sample counts: %s. '
        'This can indicate a different module family, closed holes, or damaged mesh. '
        'Please share the STL to check the exact geometry.'
        % (first[0], first[1], len(observations), summary))
