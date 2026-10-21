package com.margelo.nitro.tcgscanner

import java.nio.ByteBuffer
import androidx.annotation.Keep

/** Compact LSH postings and exact binary distances are computed in native code. */
@Keep internal object CardFeatureSearch {
  external fun create(buffers:Array<ByteBuffer>,offsets:IntArray,counts:IntArray,cachePath:String,cacheKey:String):Long
  external fun rank(handle:Long,query:ByteArray,limit:Int,expanded:Boolean):IntArray
  external fun match(handle:Long,card:Int,query:ByteArray):IntArray
  external fun destroy(handle:Long)
}
