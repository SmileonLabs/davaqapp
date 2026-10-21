package com.margelo.nitro.tcgscanner

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.os.SystemClock
import androidx.camera.core.ImageProxy
import org.opencv.android.OpenCVLoader
import org.opencv.calib3d.Calib3d
import org.opencv.core.*
import org.opencv.features2d.ORB
import org.opencv.imgproc.Imgproc
import org.opencv.video.Video
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions

/** Frame input, binary descriptor search and motion tracking stay outside JS. */
object CardVisionEngine {
  data class Event(val id: String = "", val ids: List<String> = emptyList(), val confirmed: Boolean = false,
    val inliers: Int = 0, val coverage: Double = 0.0, val processingMs: Double = 0.0,
    val trackingMs: Double = 0.0, val ready: Int = 0, val message: String = "", val corners: List<Point> = emptyList(), val searched:Boolean=false,
    val retrievalMs:Double=0.0,val verificationMs:Double=0.0,val frames:Int=0,
    val cardsJson:String="[]",val similarity:Double=0.0,val ocrMs:Double=0.0)
  @Volatile var onEvent: ((Event) -> Unit)? = null
  @Volatile var onQuad: ((List<Point>, Boolean) -> Unit)? = null
  @Volatile var viewWidth=0.0
  @Volatile var viewHeight=0.0
  private val worker = Executors.newSingleThreadExecutor()
  private val recognition = Executors.newSingleThreadExecutor()
  private val indexBuilder = Executors.newSingleThreadExecutor()
  private val ocrWorker=Executors.newSingleThreadExecutor()
  private val ocrBusy=AtomicBoolean(false)
  private val latin by lazy {TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)}
  private val japanese by lazy {TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())}
  private val korean by lazy {TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())}
  private val busy = AtomicBoolean(false)
  private val recognitionBusy = AtomicBoolean(false)
  @Volatile private var enabled = false
  @Volatile private var generation = 0
  @Volatile private var configuration = 0
  private var configuredPaths = emptyList<String>()
  @Volatile private var desiredIds:Set<String> = emptySet()
  @Volatile private var loaded = false
  private lateinit var orb: ORB
  private lateinit var clahe: org.opencv.imgproc.CLAHE
  @Volatile private var library = VisualIndex(emptyList())
  @Volatile private var compact:CompactCardIndex?=null
  private var imageVerifier:CompactImageVerifier?=null
  private var compactKey=""
  @Volatile private var compactLanguage="all"
  private var frameBytes=ByteArray(0)
  private var proposals=emptyList<List<Point>>()
  // The index ID may have a catalog: prefix absent from the public card ID.
  // Keep that identity, its printing and its price evidence in one snapshot.
  private data class AcceptedCompactCard(val id:String,val card:JSONObject,val comparables:List<JSONObject> = emptyList())
  @Volatile private var lastAccepted:AcceptedCompactCard?=null
  private var ocrAt=0L
  @Volatile private var cardTextIdentity=""
  @Volatile private var cardTextAt=0L
  @Volatile private var textCandidates=emptyList<CompactCardIndex.Candidate>()
  @Volatile private var textCandidatesAt=0L
  private var previous: Mat? = null
  private var tracked = emptyList<Point>()
  private var flowPoints = emptyList<Point>()
  private var matchAt = 0L
  private var geometryAt = 0L
  private var eventAt = 0L
  private var quadAt = 0L
  @Volatile private var lastId = ""
  private var pendingId = ""
  private var pendingCount = 0
  private var lastSearch = Event()
  private var trackingConfirmed=false
  private var verifiedAt=0L
  private var catalogAt=0L
  private var frames=0

  @Synchronized private fun initialize() {
    if (loaded) return
    check(OpenCVLoader.initLocal()) { "OpenCV initialization failed" }
    Core.setNumThreads(2)
    orb = ORB.create(1000, 1.2f, 8, 12, 0, 2, ORB.HARRIS_SCORE, 31, 8)
    clahe = Imgproc.createCLAHE(2.0, Size(8.0, 8.0))
    loaded = true
  }

  @Synchronized fun configure(paths: List<String>, ids: Set<String>, callback: (Int) -> Unit, failure: (String) -> Unit) {
    android.util.Log.d("TCGScanner","configure parts=${paths.size} cards=${ids.size}")
    if(paths==configuredPaths&&ids==desiredIds&&library.references.isNotEmpty()){callback(library.references.size);return}
    desiredIds=ids
    configuredPaths=paths.toList()
    val token = ++configuration
    indexBuilder.execute {
      try {
        // Download batches may supersede one another. Do not rebuild obsolete
        // large indexes before preparing the newest available batch.
        if(token!=configuration){callback(library.references.size);return@execute}
        // The index is needed by the visible scanner. Android's background
        // scheduling group can starve it while camera frames keep arriving.
        // A separate single worker bounds its CPU without delaying readiness.
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_DEFAULT)
        val preparedAt=SystemClock.elapsedRealtime()
        initialize()
        if(library.references.isEmpty()){
          val restored=VisualIndex.restore(paths,ids)
          if(restored!=null){
            val unchanged=restored.matches(paths,ids)
            recognition.execute {if(library.references.isEmpty()&&restored.references.all{it.id in desiredIds}){
              library=restored;worker.execute {emit(Event(ready=restored.references.size),true)}
            }else restored.close();if(unchanged)callback(library.references.size)}
            if(unchanged)return@execute
          }
        }
        val next = VisualIndex.read(paths, ids)
        android.util.Log.d("TCGScanner","index ready=${next.references.size} ms=${SystemClock.elapsedRealtime()-preparedAt}")
        // Swap and free JNI handles only between searches. Download progress
        // never invalidates camera frames or waits ahead of card recognition.
        recognition.execute {
          if(token==configuration||(library.references.isEmpty()&&next.references.all{it.id in desiredIds})){
            compact?.close();compact=null;compactKey=""
            val old=library;library=next;old.close();pendingId="";pendingCount=0
            worker.execute {emit(Event(ready=next.references.size),true);callback(library.references.size)}
          }else{next.close();callback(library.references.size)}
        }
      } catch (e: Exception) {
        if(token==configuration){synchronized(this){configuredPaths=emptyList()};failure("인식 데이터 오류: ${e.message}")}
        else callback(library.references.size)
      }
    }
  }

  @Synchronized fun configureCompact(parts:List<CompactCardIndex.Part>,language:String,callback:(Int)->Unit,failure:(String)->Unit) {
    require(parts.size==4 && language in listOf("all","ko","ja","en"))
    val key=parts.joinToString {it.path+":"+it.sha256}
    if(key==compactKey && compact!=null){
      compactLanguage=language;configuration++
      worker.execute {reset();callback(compact!!.count)}
      return
    }
    val token=++configuration
    indexBuilder.execute {
      try {
        initialize()
        val prepared=CompactCardIndex(parts[0],parts[1],parts[2],parts[3])
        recognition.execute {
          if(token!=configuration){prepared.close();callback(0);return@execute}
          val previous=compact;compact=prepared;compactLanguage=language;compactKey=key;previous?.close()
          if(imageVerifier==null)imageVerifier=CompactImageVerifier(java.io.File(java.io.File(parts[2].path).parentFile,"verification-v1"))
          library.close();library=VisualIndex(emptyList());configuredPaths=emptyList();desiredIds=emptySet()
          worker.execute {reset();callback(prepared.count)}
        }
      }catch(error:Exception){if(token==configuration)failure("카드 데이터 오류: ${error.message}")else callback(0)}
    }
  }
  fun verifyCompact(part:CompactCardIndex.Part,callback:()->Unit,failure:(String)->Unit) {
    indexBuilder.execute {try{CompactCardIndex.validate(part);callback()}catch(error:Exception){failure(error.message?:"카드 데이터 검증 실패")}}
  }

  @Synchronized fun setEnabled(value: Boolean) {
    if(enabled==value)return
    enabled=value;generation++
    if(!value)worker.execute {reset()}
  }
  private fun reset() {
    previous?.release(); previous = null; tracked = emptyList(); flowPoints = emptyList()
    matchAt = 0; geometryAt = 0; lastId = ""; lastSearch=Event();trackingConfirmed=false
    verifiedAt=0;catalogAt=0;frames=0;onQuad?.invoke(emptyList(),false)
    proposals=emptyList();pendingId="";pendingCount=0;lastAccepted=null;ocrAt=0
    cardTextIdentity="";cardTextAt=0
    textCandidates=emptyList();textCandidatesAt=0
  }

  fun accept(image: ImageProxy, mirrored: Boolean, vw: Double, vh: Double) {
    if (!enabled || vw <= 0 || vh <= 0 || !busy.compareAndSet(false, true)) return
    val token = generation
    try {
      val plane = image.planes[0]
      val crop = image.cropRect
      val channels=if(plane.pixelStride==4 && image.planes.size==1)4 else 1
      val size=crop.width()*crop.height()*channels
      if(frameBytes.size!=size)frameBytes=ByteArray(size)
      val data=frameBytes
      val buffer = plane.buffer.duplicate()
      val origin = buffer.position()
      for (y in 0 until crop.height()) {
        val row = origin + (y + crop.top) * plane.rowStride + crop.left * plane.pixelStride
        if (plane.pixelStride == channels) { buffer.position(row); buffer.get(data, y * crop.width()*channels, crop.width()*channels) }
        else for (x in 0 until crop.width()) data[y * crop.width() + x] = buffer.get(row + x * plane.pixelStride)
      }
      val rotation = image.imageInfo.rotationDegrees
      worker.execute {
        var mat: Mat? = null
        try {
          if (!enabled || token != generation) return@execute
          initialize()
          mat = Mat(crop.height(), crop.width(), if(channels==4)CvType.CV_8UC4 else CvType.CV_8UC1); mat!!.put(0, 0, data)
          when (rotation) {
            90 -> Core.rotate(mat, mat, Core.ROTATE_90_CLOCKWISE)
            180 -> Core.rotate(mat, mat, Core.ROTATE_180)
            270 -> Core.rotate(mat, mat, Core.ROTATE_90_COUNTERCLOCKWISE)
          }
          if (mirrored) Core.flip(mat, mat, 1)
          val prepared=viewport(mat!!,vw/vh)
          val gray=Mat();val rgb=Mat()
          try {
            if(channels==4){Imgproc.cvtColor(prepared,gray,Imgproc.COLOR_RGBA2GRAY);Imgproc.cvtColor(prepared,rgb,Imgproc.COLOR_RGBA2RGB)}
            else prepared.copyTo(gray)
            if(compact!=null){check(channels==4){"RGB camera frames are required"};analyzeCompact(gray,rgb)}else analyze(gray)
          }finally{prepared.release();gray.release();rgb.release()}
        } catch (e: Exception) { emit(Event(ready = compact?.count?:library.references.size, message = "프레임 처리 오류: ${e.message}"), true) }
        finally { mat?.release(); busy.set(false) }
      }
    } catch (_: Exception) { busy.set(false) }
  }

  fun photo(path: String, vw: Double, vh: Double, callback: (Event) -> Unit) {
    worker.execute {
      var rgba: Mat? = null
      var gray: Mat? = null
      try {
        initialize(); reset()
        val options=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(path,options)
        require(options.outWidth>0&&options.outHeight>0){"사진을 열지 못했습니다"}
        options.inJustDecodeBounds=false;options.inSampleSize=1
        while(max(options.outWidth,options.outHeight)/options.inSampleSize>1800)options.inSampleSize*=2
        val bitmap = BitmapFactory.decodeFile(path,options) ?: error("사진을 열지 못했습니다")
        rgba = Mat(); org.opencv.android.Utils.bitmapToMat(bitmap, rgba); bitmap.recycle()
        gray = Mat(); Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
        if(compact!=null){
          val rgb=Mat();Imgproc.cvtColor(rgba,rgb,Imgproc.COLOR_RGBA2RGB)
          val input=photoViewport(rgb,vw/vh);rgb.release();val tracking=Mat();Imgproc.cvtColor(input,tracking,Imgproc.COLOR_RGB2GRAY)
          val bounds=Rect((input.cols()-gray.cols())/2,(input.rows()-gray.rows())/2,gray.cols(),gray.rows())
          propose(tracking)
          val geometry=proposals.toList();val token=generation;val config=configuration
          recognition.execute {try{val result=searchCompact(input,geometry,bounds,true)
            worker.execute{try{if(token==generation&&config==configuration){applyCompact(result,tracking,true);callback(result.event)}else callback(Event())}finally{result.crop?.release();input.release();tracking.release()}}
          }catch(error:Exception){input.release();tracking.release();callback(Event(message=error.message?:"사진 분석 실패"))}}
          return@execute
        }
        val input = photoViewport(gray, vw / vh)
        val bounds=Rect((input.cols()-gray.cols())/2,(input.rows()-gray.rows())/2,gray.cols(),gray.rows())
        propose(input);val hasQuad=tracked.size==4;if(hasQuad)publishQuad(input,false)
        val token=generation
        recognition.execute {
          try { val result=search(input,true,"",hasQuad,0.0,bounds)
            worker.execute { try { if(token==generation){applyResult(result,input,true);callback(result.event)}else callback(Event()) } finally {input.release()} }
          } catch(e:Exception){input.release();callback(Event(message=e.message?:"사진 분석 실패"))}
        }
      } catch (e: Exception) { callback(Event(message = e.message ?: "사진 분석 실패")) }
      finally { rgba?.release(); gray?.release() }
    }
  }

  private fun viewport(gray: Mat, aspect: Double, shrink: Boolean = true): Mat {
    val sourceAspect = gray.cols().toDouble() / gray.rows()
    val w = if (sourceAspect > aspect) (gray.rows() * aspect).roundToInt() else gray.cols()
    val h = if (sourceAspect > aspect) gray.rows() else (gray.cols() / aspect).roundToInt()
    val crop = gray.submat(Rect((gray.cols()-w)/2, (gray.rows()-h)/2, w, h))
    val result = Mat(); val scale = if(shrink) min(1.0, 1280.0 / max(w, h)) else 1.0
    Imgproc.resize(crop, result, Size((w*scale).roundToInt().toDouble(), (h*scale).roundToInt().toDouble())); crop.release()
    return result
  }

  private fun photoViewport(gray:Mat,aspect:Double):Mat {
    // Match the image's contain display. Cover-cropping a card-shaped photo to
    // a tall phone viewport removed its sides before recognition even started.
    val width=gray.cols();val height=max(gray.rows(),(width/aspect).roundToInt())
    val canvasWidth=max(width,(gray.rows()*aspect).roundToInt())
    val result=Mat();Core.copyMakeBorder(gray,result,(height-gray.rows())/2,(height-gray.rows()+1)/2,
      (canvasWidth-width)/2,(canvasWidth-width+1)/2,Core.BORDER_CONSTANT,Scalar(0.0))
    return result
  }

  private fun analyze(gray: Mat) {
    val now = SystemClock.elapsedRealtime()
    val trackStart = SystemClock.elapsedRealtimeNanos()
    val flow = track(gray)
    frames++
    if(!flow||trackingConfirmed&&now-verifiedAt>1500)clearTracking()
    if (!flow && now - geometryAt > 180) { geometryAt = now; propose(gray) }
    val trackMs = (SystemClock.elapsedRealtimeNanos()-trackStart)/1e6
    if (tracked.size == 4) publishQuad(gray, flow && trackingConfirmed)
    savePrevious(gray)
    emit(lastSearch.copy(id="",confirmed=false,searched=false,ready=library.references.size,trackingMs=trackMs))
    if(library.references.isEmpty()||now-matchAt < (if(flow&&trackingConfirmed)200 else 120)||!recognitionBusy.compareAndSet(false,true))return
    matchAt = now
    val input=gray.clone();val token=generation;val cachedId=if(flow&&trackingConfirmed&&now-catalogAt<1000)lastId else "";val hasQuad=tracked.size==4
    if(cachedId.isEmpty())catalogAt=now
    recognition.execute {
      try { val result=search(input,false,cachedId,hasQuad,trackMs)
        worker.execute { try{if(enabled&&token==generation)applyResult(result,input,false)}finally{input.release();recognitionBusy.set(false)} }
      } catch(e:Exception){input.release();recognitionBusy.set(false);worker.execute{emit(Event(ready=library.references.size,message="그림 검색 오류: ${e.message}"),true)}}
    }
  }

  private data class SearchResult(val event:Event,val match:Verified?)
  private data class CompactResult(val event:Event,val corners:List<Point>,val candidates:List<CompactCardIndex.Candidate>,val crop:Mat?,val visuallyVerified:Boolean)
  private fun guide(frame:Mat):Rect {
    val width=min(frame.cols()*.72,frame.rows()*.62*.716).roundToInt().coerceAtLeast(1)
    val height=(width/.716).roundToInt().coerceAtMost(frame.rows())
    return Rect((frame.cols()-width)/2,(frame.rows()*.51-height/2).roundToInt().coerceIn(0,frame.rows()-height),width,height)
  }
  private fun warp(rgb:Mat,quad:List<Point>):Mat {
    val from=MatOfPoint2f(*quad.toTypedArray());val to=MatOfPoint2f(Point(0.0,0.0),Point(447.0,0.0),Point(447.0,625.0),Point(0.0,625.0))
    val transform=Imgproc.getPerspectiveTransform(from,to);val result=Mat()
    try{Imgproc.warpPerspective(rgb,result,transform,Size(448.0,626.0),Imgproc.INTER_LINEAR,Core.BORDER_REPLICATE);return result}
    catch(error:Exception){result.release();throw error}
    finally{from.release();to.release();transform.release()}
  }
  private fun analyzeCompact(gray:Mat,rgb:Mat) {
    val now=SystemClock.elapsedRealtime();val began=SystemClock.elapsedRealtimeNanos();val flow=track(gray);frames++
    if(!flow)clearTracking()
    if(!flow || now-geometryAt>600){geometryAt=now;propose(gray,!flow)}
    if(tracked.size==4)publishQuad(gray,trackingConfirmed && flow)
    val trackMs=(SystemClock.elapsedRealtimeNanos()-began)/1e6
    savePrevious(gray)
    emit(lastSearch.copy(id="",confirmed=false,searched=false,cardsJson="[]",ready=compact?.count?:0,trackingMs=trackMs))
    if(now-matchAt<100 || !recognitionBusy.compareAndSet(false,true))return
    matchAt=now
    val input=rgb.clone();val tracking=gray.clone();val geometry=(listOf(tracked)+proposals).filter {it.size==4}.distinct().take(3)
    val token=generation;val config=configuration
    recognition.execute {
      var handedOff=false
      try {
        if(!enabled||token!=generation||config!=configuration)return@execute
        val result=searchCompact(input,geometry,null,false)
        worker.execute {try{if(enabled&&token==generation&&config==configuration)applyCompact(result,tracking,false)}finally{result.crop?.release();tracking.release();recognitionBusy.set(false)}}
        handedOff=true
      }catch(error:Exception){worker.execute{if(token==generation)emit(Event(ready=compact?.count?:0,message="카드 검색 오류: ${error.message}"),true)}}
      finally{input.release();if(!handedOff){tracking.release();recognitionBusy.set(false)}}
    }
  }
  private fun searchCompact(rgb:Mat,geometry:List<List<Point>>,bounds:Rect?,photo:Boolean):CompactResult {
    val index=compact?:error("Card data is not ready");val started=SystemClock.elapsedRealtimeNanos()
    var region=rgb.submat(bounds?:guide(rgb));var found=index.search(region,compactLanguage,32)
    var corners=emptyList<Point>()
    try {
      val verificationAt=SystemClock.elapsedRealtimeNanos()
      var verified=imageVerifier?.verify(rgb,found,false)?.filter{valid(it.corners,rgb)}?:emptyList()
      val pools=ArrayList<List<CompactCardIndex.Candidate>>();pools.add(found)
      val read=textCandidates.takeIf{SystemClock.elapsedRealtime()-textCandidatesAt<2500}?:emptyList()
      if(read.isNotEmpty())pools.add(0,read)
      // Sleeves, slabs and a distant card can fill the guide with background.
      // Search nested guide crops before relying on contour geometry. These
      // crops are retrieval inputs, never claimed as detected card corners.
      if(bounds==null && verified.isEmpty()) {
        val g=guide(rgb)
        for(scale in listOf(.82,.64)) {
          val w=(g.width*scale).roundToInt();val h=(g.height*scale).roundToInt()
          val candidate=rgb.submat(Rect(g.x+(g.width-w)/2,g.y+(g.height-h)/2,w,h))
          val matches=try{index.search(candidate,compactLanguage,32)}catch(error:Exception){candidate.release();throw error}
          pools.add(matches)
          if((matches.firstOrNull()?.similarity?:0.0)>(found.firstOrNull()?.similarity?:0.0)) {
            region.release();region=candidate;found=matches
          }else candidate.release()
        }
      }
      for(quad in geometry) {
        if(verified.isNotEmpty())break
        val candidate=warp(rgb,quad)
        val matches=try{index.search(candidate,compactLanguage,32)}catch(error:Exception){candidate.release();throw error}
        pools.add(matches)
        if((matches.firstOrNull()?.similarity?:0.0)>=(found.firstOrNull()?.similarity?:0.0)-.005) {
          region.release();region=candidate;found=matches;corners=quad
        }else candidate.release()
      }
      // Interleave ranks so an overconfident wrong crop cannot discard the
      // correct guide/other-crop candidate. Bound both memory and verification.
      found=(0 until 32).flatMap{rank->pools.mapNotNull{it.getOrNull(rank)}}.distinctBy{it.id}.take(96)
      if(verified.isEmpty())verified=imageVerifier?.verify(rgb,found,photo)?.filter{valid(it.corners,rgb)}?:emptyList()
      val proof=verified.firstOrNull{valid(it.corners,rgb)}
      val best=proof?.candidate?:found.firstOrNull();val score=best?.similarity?:0.0
      if(proof!=null)corners=proof.corners
      pendingCount=if(best!=null && pendingId==best.id)pendingCount+1 else 1;pendingId=best?.id?:""
      // A stable nearest neighbour is not evidence that a card is present.
      // Spatial artwork verification is required even for a very high cosine.
      val accepted=proof!=null
      val previousCard=lastAccepted
      val confirmedCandidates=verified.map{it.candidate}
      val previousPrinting=previousCard?.card?.optString("matchLevel")=="printing" && confirmedCandidates.any {it.id==previousCard.id}
      val retained=accepted&&previousCard!=null&&(previousCard.id==best!!.id||previousPrinting)
      val id=if(accepted){if(retained)previousCard!!.id else best!!.id}else ""
      val card=if(accepted){if(retained)previousCard!!.card else CompactIdentity.reference(best!!,confirmedCandidates)}else null
      val cards=JSONArray();if(card!=null)cards.put(card)
      if(retained)previousCard!!.comparables.forEach {cards.put(it)}
      confirmedCandidates.take(8).filter {it.id!=id}.forEach {cards.put(it.card)}
      val related=if(!accepted&&cardTextIdentity==pendingId&&SystemClock.elapsedRealtime()-cardTextAt<2000&&geometry.isNotEmpty())found.filter{it.similarity>=.55}.take(3)else emptyList()
      related.forEach{cards.put(it.card)}
      val event=Event(id=id,ids=(if(accepted)confirmedCandidates.take(8)else related).map {it.id},confirmed=accepted,searched=true,
        inliers=proof?.inliers?:0,coverage=proof?.coverage?:0.0,verificationMs=(SystemClock.elapsedRealtimeNanos()-verificationAt)/1e6,
        ready=index.count,cardsJson=cards.toString(),similarity=score*100,processingMs=(SystemClock.elapsedRealtimeNanos()-started)/1e6)
      val crop=if(proof!=null)warp(rgb,proof.corners)else if(found.isNotEmpty()&&score>=.55)region.clone()else null
      return CompactResult(event,corners,if(accepted)confirmedCandidates else found,crop,accepted)
    }finally{region.release()}
  }
  private fun applyCompact(result:CompactResult,gray:Mat,photo:Boolean) {
    var event=result.event
    // OCR can finish while an image search is in flight. Do not let that older
    // artwork result downgrade the printing or erase its price comparables.
    val accepted=lastAccepted
    if(event.confirmed&&accepted?.card?.optString("matchLevel")=="printing"&&result.candidates.any {it.id==accepted.id}) {
      val cards=JSONArray().put(accepted.card)
      accepted.comparables.forEach {cards.put(it)}
      event=event.copy(id=accepted.id,cardsJson=cards.toString())
    }
    if(event.confirmed){
      val card=JSONArray(event.cardsJson).optJSONObject(0)
      lastAccepted=card?.let{AcceptedCompactCard(event.id,it,if(accepted?.id==event.id)accepted.comparables else emptyList())}
      lastId=event.id
      trackingConfirmed=true
      if(result.corners.size==4){
        val latest=previous;tracked=result.corners;seed(gray)
        if(!photo&&latest!=null){previous=gray;try{if(!track(latest))clearTracking()}finally{previous=latest}}
        if(tracked.size==4)publishQuad(latest?:gray,true)
      }
    }
    lastSearch=event;emit(event,event.confirmed||photo)
    result.crop?.let {startOcr(it,result.candidates,photo,result.visuallyVerified)}
  }
  private fun startOcr(crop:Mat,candidates:List<CompactCardIndex.Candidate>,photo:Boolean,visuallyVerified:Boolean) {
    val now=SystemClock.elapsedRealtime()
    if(now-ocrAt<800||!ocrBusy.compareAndSet(false,true))return
    ocrAt=now;val token=generation;val config=configuration;val identity=pendingId;val index=compact?:run{ocrBusy.set(false);return}
    val bitmap=Bitmap.createBitmap(crop.cols(),crop.rows(),Bitmap.Config.ARGB_8888)
    try{org.opencv.android.Utils.matToBitmap(crop,bitmap)}catch(error:Exception){bitmap.recycle();ocrBusy.set(false);return}
    ocrWorker.execute {
      val languages=if(compactLanguage=="all")candidates.take(8).map {it.card.optString("language")}.filter {it in listOf("ko","ja","en")}.distinct() else listOf(compactLanguage)
      fun finish(){bitmap.recycle();ocrBusy.set(false)}
      fun read(position:Int) {
        if(position>=languages.size||token!=generation||config!=configuration||SystemClock.elapsedRealtime()-now>=3500){finish();return}
        try {
          val recognizer=when(languages[position]){"ja"->japanese;"ko"->korean;else->latin}
          recognizer.process(InputImage.fromBitmap(bitmap,0)).addOnCompleteListener(ocrWorker) { task ->
            val text=if(task.isSuccessful)task.result.text else ""
            val exact=if(visuallyVerified)CompactIdentity.exact(candidates,text,compactLanguage)else null
            if(exact==null&&text.isNotBlank())recognition.execute {
              if(token==generation&&config==configuration&&compact===index&&(enabled||photo)) {
                val matches=index.searchText(text,compactLanguage)
                if(matches.isNotEmpty()){textCandidates=matches;textCandidatesAt=SystemClock.elapsedRealtime()}
              }
            }
            if(!visuallyVerified&&CompactIdentity.cardText(text))worker.execute {
              if(token==generation&&config==configuration&&pendingId==identity&&tracked.size==4&&(enabled||photo)){
                cardTextIdentity=identity;cardTextAt=SystemClock.elapsedRealtime()
                val related=candidates.filter{it.similarity>=.55}.take(3)
                emit(lastSearch.copy(id="",confirmed=false,searched=true,ids=related.map{it.id},cardsJson=JSONArray(related.map{it.card}).toString()),true)
              }
            }
            if(exact==null){read(position+1);return@addOnCompleteListener}
            try { recognition.execute {
                if(token==generation && config==configuration && compact===index){
                  val card=JSONObject(exact.card.toString()).put("matchLevel","printing")
                  val reference=CompactIdentity.reference(exact,candidates)
                  card.put("valuations",reference.getJSONArray("valuations"))
                  if(reference.has("referenceThumbnail"))card.put("referenceThumbnail",reference.getJSONObject("referenceThumbnail"))
                  val comparables=index.comparables(card)
                  val cards=JSONArray().put(card);comparables.forEach {cards.put(it)}
                  worker.execute {
                  if(token==generation && config==configuration && (pendingId==identity||lastSearch.confirmed&&exact.id in lastSearch.ids) && (enabled||photo)){
                    lastAccepted=AcceptedCompactCard(exact.id,card,comparables);lastId=exact.id
                    lastSearch=lastSearch.copy(id=exact.id,confirmed=true,searched=true,cardsJson=cards.toString(),ocrMs=(SystemClock.elapsedRealtime()-now).toDouble())
                    emit(lastSearch,true)
                  }
                  }
                }
              }}finally{finish()}
          }
        }catch(error:Exception){finish();android.util.Log.d("TCGScanner","OCR unavailable: ${error.message}")}
      }
      read(0)
    }
  }
  /** Runs on the separate recognition worker; frame tracking never waits here. */
  private fun search(gray:Mat,photo:Boolean,cachedId:String,hasQuad:Boolean,trackMs:Double,photoBounds:Rect?=null):SearchResult {
    val start=SystemClock.elapsedRealtimeNanos()
    val equalized = Mat(); val keypoints = MatOfKeyPoint(); val descriptors = Mat(); val mask = Mat()
    // Preserve the card's name, number and picture. The broad camera region
    // does not depend on a contour, sleeve or monitor border being detected.
    val bounds=photoBounds?:Rect(0,(gray.rows()*.08).toInt(),gray.cols(),(gray.rows()*.84).toInt())
    val height=bounds.height
    // Catalog descriptors use 448px. A larger live query changed its pyramid
    // features and made photographs that passed the photo path fail in-camera.
    val width=448.0
    val region=gray.submat(bounds);val search=Mat();val scale=width/bounds.width
    var event = Event(ready=library.references.size)
    try {
      Imgproc.resize(region,search,Size(width,(height*scale).roundToInt().toDouble()))
      clahe.apply(search, equalized); orb.detectAndCompute(equalized, mask, keypoints, descriptors)
      val points = keypoints.toArray().map { Point(it.pt.x/scale+bounds.x,it.pt.y/scale+bounds.y) }
      val bytes=ByteArray(descriptors.rows()*32);if(bytes.isNotEmpty())descriptors.get(0,0,bytes)
      // A tracked identity is checked directly; catalog retrieval is needed only
      // when that picture is no longer present. This keeps repeated scans cheap.
      val cachedStart=SystemClock.elapsedRealtimeNanos()
      val cachedIndex=if(cachedId.isNotEmpty())library.references.indexOfFirst{it.id==cachedId} else -1
      val cached = if(cachedIndex>=0)verify(cachedIndex,points,bytes,gray) else null
      val cachedMs=(SystemClock.elapsedRealtimeNanos()-cachedStart)/1e6
      val retrievalStart=SystemClock.elapsedRealtimeNanos()
      var shortlist = if(cached!=null)emptyList() else library.rank(bytes,32)
      var retrievalMs=(SystemClock.elapsedRealtimeNanos()-retrievalStart)/1e6
      val verifyStart=SystemClock.elapsedRealtimeNanos()
      val verified=ArrayList<Verified>();if(cached!=null)verified.add(cached)
      for((position,candidate)in shortlist.withIndex()){
        if(position>=8&&verified.isNotEmpty())break
        val result=verify(candidate.first,points,bytes,gray)?:continue;verified.add(result)
      }
      verified.sortByDescending{it.score}
      var verificationMs=(SystemClock.elapsedRealtimeNanos()-verifyStart)/1e6+cachedMs
      if(verified.isEmpty()&&bytes.isNotEmpty()){
        val expandedStart=SystemClock.elapsedRealtimeNanos()
        val expanded=library.rank(bytes,48,true)
        retrievalMs+=(SystemClock.elapsedRealtimeNanos()-expandedStart)/1e6
        val tried=shortlist.map{it.first}.toSet();shortlist=expanded
        val retryStart=SystemClock.elapsedRealtimeNanos()
        for((position,candidate)in expanded.withIndex()){
          if(position>=8&&verified.isNotEmpty())break
          val index=candidate.first;if(index in tried)continue
          val result=verify(index,points,bytes,gray)?:continue;verified.add(result)
        }
        verified.sortByDescending{it.score}
        verificationMs+=(SystemClock.elapsedRealtimeNanos()-retryStart)/1e6
      }
      val best = verified.firstOrNull()
      if(photo)android.util.Log.d("TCGScanner","photo candidates="+shortlist.joinToString{library.references[it.first].id+":"+it.second}+" verified="+(best?.id?:"none"))
      if (best != null) {
        val strong = best.inliers >= 18 && best.coverage >= .12
        pendingCount = if (pendingId == best.id) pendingCount+1 else 1; pendingId = best.id
        val accepted = photo || strong || pendingCount >= 2
        // An unverified nearest neighbour never clears or replaces the result.
        if (accepted) {
          event = Event(best.id, verified.take(3).map { it.id }, true, best.inliers, best.coverage,
            ready=library.references.size, corners=normalized(best.corners,gray))
        }
      } else { pendingId = ""; pendingCount = 0; event = Event(ready=library.references.size) }
      event = event.copy(processingMs=(SystemClock.elapsedRealtimeNanos()-start)/1e6, trackingMs=trackMs,searched=true,retrievalMs=retrievalMs,verificationMs=verificationMs)
      return SearchResult(event,if(event.confirmed)best else null)
    } finally { region.release();search.release();equalized.release(); keypoints.release(); descriptors.release(); mask.release() }
  }

  /** Bring a delayed search's corners forward to the latest tracking frame. */
  private fun applyResult(result:SearchResult,input:Mat,photo:Boolean) {
    val match=result.match
    if(match!=null){
      val current=previous
      tracked=match.corners;flowPoints=match.points
      if(!photo&&current!=null){previous=input
        val aligned=try{track(current)}finally{previous=current}
        trackingConfirmed=aligned
        if(aligned)publishQuad(current,true) else clearTracking()
      } else {trackingConfirmed=true;publishQuad(input,true)}
      lastId=match.id
      verifiedAt=SystemClock.elapsedRealtime()
    }else if(result.event.searched){
      clearTracking()
    }
    lastSearch=result.event;emit(result.event,result.event.confirmed||photo)
  }

  private data class Verified(val id: String, val inliers: Int, val coverage: Double, val corners: List<Point>, val points: List<Point>,val score:Double)
  private fun verify(index:Int,query:List<Point>,descriptors:ByteArray,gray:Mat):Verified? {
    val ref=library.references[index]
    if(descriptors.isEmpty()||ref.count<12)return null
    val good=library.match(index,descriptors).toList().chunked(2)
    if(good.size<12)return null
    val source=good.map{val at=ref.offset+it[0]*40;Point(ref.buffer.getFloat(at).toDouble(),ref.buffer.getFloat(at+4).toDouble())}
    val target=good.map{query[it[1]]}
    val from=MatOfPoint2f();val to=MatOfPoint2f();val mask=Mat()
    var homography:Mat?=null
    try {
      from.fromList(source);to.fromList(target)
      homography=Calib3d.findHomography(from,to,Calib3d.RANSAC,4.0,mask,1200,.995)
      if(homography.empty())return null
      val accepted=good.indices.filter { mask.get(it,0)[0]!=0.0 }
      if(accepted.size<12||accepted.size.toDouble()/good.size<.45)return null
      val inlierSource=accepted.map { source[it] }
      val coverage=hullArea(inlierSource)/(ref.bounds.width*ref.bounds.height)
      if(coverage<.10)return null
      // A shared HP/header/footer template does not identify the illustration.
      val core=inlierSource.filter{it.x in (ref.bounds.x+ref.bounds.width*.08)..(ref.bounds.x+ref.bounds.width*.92)&&
        it.y in (ref.bounds.y+ref.bounds.height*.14)..(ref.bounds.y+ref.bounds.height*.78)}
      val coreCoverage=hullArea(core)/(ref.bounds.width*ref.bounds.height)
      if(core.size<8||coreCoverage<.06)return null
      val b=ref.bounds
      val input=MatOfPoint2f(Point(b.x,b.y),Point(b.x+b.width,b.y),Point(b.x+b.width,b.y+b.height),Point(b.x,b.y+b.height))
      val output=MatOfPoint2f()
      try { Core.perspectiveTransform(input,output,homography); val corners=output.toList(); if(!valid(corners,gray))return null
        return Verified(ref.id,accepted.size,coverage,corners,accepted.map{target[it]},core.size*(.5+coreCoverage))
      } finally { input.release();output.release() }
    } finally { from.release();to.release();mask.release();homography?.release() }
  }

  private fun track(gray:Mat):Boolean {
    val old=previous?:return false
    if(old.size()!=gray.size()||tracked.size!=4||flowPoints.size<12)return false
    // Motion uses a small luminance pyramid. Recognition keeps the original
    // frame detail, so lowering tracking cost does not lower search accuracy.
    val scale=min(1.0,640.0/max(gray.cols(),gray.rows()));val oldSmall=Mat();val currentSmall=Mat()
    val size=Size((gray.cols()*scale).roundToInt().toDouble(),(gray.rows()*scale).roundToInt().toDouble())
    val from=MatOfPoint2f();from.fromList(flowPoints.map{Point(it.x*scale,it.y*scale)});val next=MatOfPoint2f();val status=MatOfByte();val error=MatOfFloat()
    val back=MatOfPoint2f();val backStatus=MatOfByte();val backError=MatOfFloat();val mask=Mat();var transform:Mat?=null
    try {
      Imgproc.resize(old,oldSmall,size);Imgproc.resize(gray,currentSmall,size)
      Video.calcOpticalFlowPyrLK(oldSmall,currentSmall,from,next,status,error,Size(21.0,21.0),3)
      Video.calcOpticalFlowPyrLK(currentSmall,oldSmall,next,back,backStatus,backError,Size(21.0,21.0),3)
      val a=flowPoints;val b=next.toList().map{Point(it.x/scale,it.y/scale)};val c=back.toList().map{Point(it.x/scale,it.y/scale)};val s=status.toArray();val bs=backStatus.toArray()
      val good=a.indices.filter{s[it].toInt()!=0&&bs[it].toInt()!=0&&hypot(a[it].x-c[it].x,a[it].y-c[it].y)<1.5}
      if(good.size<12)return false
      from.fromList(good.map{a[it]});next.fromList(good.map{b[it]})
      transform=Calib3d.findHomography(from,next,Calib3d.RANSAC,2.5,mask,300,.99)
      if(transform.empty())return false
      val q=MatOfPoint2f();q.fromList(tracked);val moved=MatOfPoint2f()
      try { Core.perspectiveTransform(q,moved,transform);val corners=moved.toList();if(!valid(corners,gray))return false
        tracked=corners;flowPoints=good.indices.filter{mask.get(it,0)[0]!=0.0}.map{b[good[it]]};return flowPoints.size>=12
      } finally { q.release();moved.release() }
    } finally { oldSmall.release();currentSmall.release();from.release();next.release();status.release();error.release();back.release();backStatus.release();backError.release();mask.release();transform?.release() }
  }

  private fun propose(gray:Mat,apply:Boolean=true) {
    val small=Mat();val edges=Mat();val contours=ArrayList<MatOfPoint>();val hierarchy=Mat()
    val scale=min(1.0,640.0/max(gray.cols(),gray.rows()))
    try {
      Imgproc.resize(gray,small,Size((gray.cols()*scale).roundToInt().toDouble(),(gray.rows()*scale).roundToInt().toDouble()))
      Imgproc.GaussianBlur(small,edges,Size(3.0,3.0),0.0)
      Imgproc.Canny(edges,edges,25.0,90.0)
      val kernel=Imgproc.getStructuringElement(Imgproc.MORPH_RECT,Size(3.0,3.0))
      try{Imgproc.morphologyEx(edges,edges,Imgproc.MORPH_CLOSE,kernel)}finally{kernel.release()}
      Imgproc.findContours(edges,contours,hierarchy,Imgproc.RETR_LIST,Imgproc.CHAIN_APPROX_SIMPLE)
      val center=Point(gray.cols()*.5,gray.rows()*.51)
      val offered=ArrayList<Pair<List<Point>,Double>>()
      var best:List<Point>?=null;var bestScore=0.0
      val candidates=contours.map{Pair(it,abs(Imgproc.contourArea(it)))}.filter{it.second>=small.cols()*small.rows()*.03}.sortedByDescending{it.second}.take(48)
      for((c,_)in candidates) {
        val p=MatOfPoint2f(*c.toArray());val approx=MatOfPoint2f()
        try { Imgproc.approxPolyDP(p,approx,.025*Imgproc.arcLength(p,true),true);val q=order(approx.toList().map{Point(it.x/scale,it.y/scale)});if(q.size!=4||!valid(q,gray))continue
          val w=(distance(q[0],q[1])+distance(q[2],q[3]))/2;val h=(distance(q[1],q[2])+distance(q[3],q[0]))/2;val ratio=w/h
          if(ratio !in .52.. .87)continue
          val area=abs(polygonArea(q))/(gray.cols()*gray.rows());if(area !in .04.. .70)continue
          val cx=q.sumOf{it.x}/4;val cy=q.sumOf{it.y}/4
          if(compact!=null && (abs(cx-center.x)>gray.cols()*.22 || abs(cy-center.y)>gray.rows()*.22))continue
          val score=1-abs(ln(ratio/.716))-.5*hypot((cx-center.x)/gray.cols(),(cy-center.y)/gray.rows())
          offered.add(q to score)
          if(score>bestScore){best=q;bestScore=score}
        } finally { p.release();approx.release() }
      }
      proposals=offered.sortedByDescending {it.second}.take(3).map {it.first}
      if(best!=null&&apply){tracked=best;seed(gray)}
    } finally { small.release();edges.release();hierarchy.release();contours.forEach{it.release()} }
  }
  private fun seed(gray:Mat) {
    val mask=Mat.zeros(gray.size(),CvType.CV_8UC1);val polygon=MatOfPoint(*tracked.toTypedArray());val points=MatOfPoint()
    try { Imgproc.fillConvexPoly(mask,polygon,Scalar(255.0));Imgproc.goodFeaturesToTrack(gray,points,100,.01,7.0,mask);flowPoints=points.toList() }
    finally {mask.release();polygon.release();points.release()}
  }
  private fun savePrevious(gray:Mat){previous?.release();previous=gray.clone()}
  private fun clearTracking(){
    val hadTracking=tracked.isNotEmpty();tracked=emptyList();flowPoints=emptyList();trackingConfirmed=false
    if(hadTracking)onQuad?.invoke(emptyList(),false)
  }
  private fun normalized(q:List<Point>,gray:Mat)=q.map{Point((it.x/gray.cols()).coerceIn(0.0,1.0),(it.y/gray.rows()).coerceIn(0.0,1.0))}
  private fun publishQuad(gray:Mat,confirmed:Boolean){quadAt=SystemClock.elapsedRealtime();onQuad?.invoke(normalized(tracked,gray),confirmed)}
  private fun emit(event:Event,force:Boolean=false){val now=SystemClock.elapsedRealtime();if(force||now-eventAt>250){eventAt=now;onEvent?.invoke(event.copy(frames=frames))}}
  private fun distance(a:Point,b:Point)=hypot(a.x-b.x,a.y-b.y)
  private fun polygonArea(q:List<Point>)=q.indices.sumOf { i->val j=(i+1)%q.size;q[i].x*q[j].y-q[j].x*q[i].y }/2
  private fun order(q:List<Point>):List<Point>{if(q.size!=4)return emptyList();val cx=q.sumOf{it.x}/4;val cy=q.sumOf{it.y}/4;val sorted=q.sortedBy{atan2(it.y-cy,it.x-cx)};val start=sorted.indices.minBy{sorted[it].x+sorted[it].y};return List(4){sorted[(start+it)%4]}}
  private fun hullArea(q:List<Point>):Double{if(q.size<3)return 0.0;val points=MatOfPoint(*q.toTypedArray());val indices=MatOfInt();try{Imgproc.convexHull(points,indices);return abs(polygonArea(indices.toArray().map{q[it]}))}finally{points.release();indices.release()}}
  private fun valid(q:List<Point>,gray:Mat):Boolean {
    if(q.size!=4||q.any{!it.x.isFinite()||!it.y.isFinite()||it.x< -gray.cols()*.08||it.x>gray.cols()*1.08||it.y< -gray.rows()*.08||it.y>gray.rows()*1.08})return false
    val area=abs(polygonArea(q))/(gray.cols()*gray.rows());if(area !in .035.. .88)return false
    val signs=q.indices.map{ i->val a=q[i];val b=q[(i+1)%4];val c=q[(i+2)%4];(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x) }
    if(!signs.all{it>0}&&!signs.all{it<0})return false
    val w=(distance(q[0],q[1])+distance(q[2],q[3]))/2;val h=(distance(q[1],q[2])+distance(q[3],q[0]))/2
    return w/h in .45.. .95 && min(w,h)>40
  }

}
