import type { ThreeElements } from '@react-three/fiber';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { InstanceTransform } from './math';

type StaticInstancesProps = Omit<ThreeElements['instancedMesh'], 'args' | 'ref' | 'children'> & {
  instances: readonly InstanceTransform[];
  /** Geometry and material of a single instance. */
  children: ReactNode;
};

const UP = new Vector3(0, 1, 0);

/**
 * Renders many copies of one geometry in a single draw call. Transforms are
 * written once (and again only if `instances` changes), so static scenery costs
 * nothing per frame. Use a white material: per-instance colors tint it.
 */
export function StaticInstances({ instances, children, ...meshProps }: StaticInstancesProps) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const color = new Color();

    instances.forEach((instance, index) => {
      position.set(...instance.position);
      scale.set(...(instance.scale ?? [1, 1, 1]));
      rotation.setFromAxisAngle(UP, instance.rotationY ?? 0);
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale));
      if (instance.color) mesh.setColorAt(index, color.set(instance.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Bounds of all instances, so frustum culling works correctly.
    mesh.computeBoundingSphere();
  }, [instances]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, instances.length]} {...meshProps}>
      {children}
    </instancedMesh>
  );
}
