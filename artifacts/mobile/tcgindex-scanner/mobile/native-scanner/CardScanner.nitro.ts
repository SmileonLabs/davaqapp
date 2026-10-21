import type {HybridObject} from 'react-native-nitro-modules';
import type {CameraOutput} from 'react-native-vision-camera';
/** CameraX owns frame delivery and disposal; no Worklets runtime is involved. */
export interface CardScanner extends HybridObject<{android: 'kotlin'}> {
  createOutput(): CameraOutput;
}
