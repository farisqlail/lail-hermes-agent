"use strict";exports.id=33,exports.ids=[33],exports.modules={7033:(e,t,i)=>{let r;i.r(t),i.d(t,{WebGPUBackend:()=>V,webgpu_util:()=>l});var a,s,o,n,u,l={};i.r(l),i.d(l,{GPUBytesPerElement:()=>E,MatMulProgramType:()=>s,assertNotComplex:()=>W,computeDispatch:()=>D,computeWorkPerThreadForConv2d:()=>T,computeWorkgroupInfoForMatMul:()=>F,computeWorkgroupSizeForConv2d:()=>_,flatDispatchLayout:()=>L,isWebGPUSupported:()=>B,tilesFitEvenlyIntoShape:()=>A});var d=i(9589);let h=(0,d.env)();h.registerFlag("WEBGPU_DEFERRED_SUBMIT_BATCH_SIZE",()=>15),h.registerFlag("WEBGPU_CPU_FORWARD",()=>!0),h.registerFlag("WEBGPU_MATMUL_PROGRAM_TYPE",()=>-1),h.registerFlag("WEBGPU_USE_NAIVE_CONV2D_TRANSPOSE",()=>!0),h.registerFlag("WEBGPU_USE_LOW_POWER_GPU",()=>!1),h.registerFlag("WEBGPU_CPU_HANDOFF_SIZE_THRESHOLD",()=>1e3),h.registerFlag("WEBGPU_USE_PROFILE_TOOL",()=>!1),h.registerFlag("WEBGPU_IMPORT_EXTERNAL_TEXTURE",()=>!0),h.registerFlag("WEBGPU_USE_NAIVE_CONV2D_DEBUG",()=>!1),h.registerFlag("WEBGPU_THRESHOLD_TO_INCREASE_WORKGROUPS_FOR_MATMUL",()=>-1),h.registerFlag("WEBGPU_CONV_SEPARATE_IM2COL_SHADER",()=>!1),h.registerFlag("WEBGPU_PRINT_SHADER",()=>""),h.registerFlag("WEBGPU_ENGINE_COMPILE_ONLY",()=>!1);class p{constructor(e){e&&(this.vendor=e.vendor,this.architecture=e.architecture,this.intelGPUGeneration=this.getIntelGPUGeneration())}getIntelGPUGeneration(){if(this.isIntel()){if(this.architecture.startsWith("gen"))return Number(this.architecture.match(/\d+/));if(this.architecture.startsWith("xe"))return 12}return 0}isIntel(){return"intel"===this.vendor}}class c{constructor(e){this.device=e,this.numUsedBuffers=0,this.numFreeBuffers=0,this.freeBuffers=new Map,this.usedBuffers=new Map,this.numBytesUsed=0,this.numBytesAllocated=0}acquireBuffer(e,t,i=!1,r=!0){let a;let s=`${e}_${t}`;return r?(this.freeBuffers.has(s)||this.freeBuffers.set(s,[]),this.freeBuffers.get(s).length>0?(a=this.freeBuffers.get(s).pop(),this.numFreeBuffers--):(a=this.device.createBuffer({size:e,usage:t,mappedAtCreation:i}),this.numBytesAllocated+=e)):(a=this.device.createBuffer({size:e,usage:t,mappedAtCreation:i}),this.numBytesAllocated+=e),this.usedBuffers.has(s)||this.usedBuffers.set(s,[]),this.usedBuffers.get(s).push(a),this.numUsedBuffers++,this.numBytesUsed+=e,a}releaseBuffer(e,t=!0){var i;if(0===this.freeBuffers.size)return;let r=e.size,a=(i=e.usage,`${r}_${i}`),s=this.usedBuffers.get(a),o=s.indexOf(e);if(o<0)throw Error("Cannot find the buffer in buffer manager");s[o]=s[s.length-1],s.pop(),this.numUsedBuffers--,this.numBytesUsed-=r,t?(this.freeBuffers.get(a).push(e),this.numFreeBuffers++):(e.destroy(),this.numBytesAllocated-=r)}getNumUsedBuffers(){return this.numUsedBuffers}getNumFreeBuffers(){return this.numFreeBuffers}dispose(){this.freeBuffers.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.usedBuffers.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.freeBuffers=new Map,this.usedBuffers=new Map,this.numUsedBuffers=0,this.numFreeBuffers=0,this.numBytesUsed=0,this.numBytesAllocated=0}}class f{constructor(e){this.device=e,this.numUsedTextures=0,this.numFreeTextures=0,this.freeTextures=new Map,this.usedTextures=new Map,this.numBytesUsed=0,this.numBytesAllocated=0}acquireTexture(e,t,i,r){let a=e*t*g(i),s=m(e,t,i,r);if(this.freeTextures.has(s)||this.freeTextures.set(s,[]),this.usedTextures.has(s)||this.usedTextures.set(s,[]),this.numBytesUsed+=a,this.numUsedTextures++,this.freeTextures.get(s).length>0){this.numFreeTextures--;let e=this.freeTextures.get(s).shift();return this.usedTextures.get(s).push(e),e}this.numBytesAllocated+=a;let o=this.device.createTexture({size:[e,t],format:i,usage:r});return this.usedTextures.get(s).push(o),o}releaseTexture(e){if(0===this.freeTextures.size)return;let t=e.width,i=e.height,r=e.format,a=m(t,i,r,e.usage);this.freeTextures.has(a)||this.freeTextures.set(a,[]),this.freeTextures.get(a).push(e),this.numFreeTextures++,this.numUsedTextures--;let s=this.usedTextures.get(a),o=s.indexOf(e);if(o<0)throw Error("Cannot release a texture that was never provided by this texture manager");s.splice(o,1);let n=t*i*g(r);this.numBytesUsed-=n}getNumUsedTextures(){return this.numUsedTextures}getNumFreeTextures(){return this.numFreeTextures}dispose(){this.freeTextures.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.usedTextures.forEach((e,t)=>{e.forEach(e=>{e.destroy()})}),this.freeTextures=new Map,this.usedTextures=new Map,this.numUsedTextures=0,this.numFreeTextures=0,this.numBytesUsed=0,this.numBytesAllocated=0}}function m(e,t,i,r){return`${e}_${t}_${i}_${r}`}function g(e){if("rgba8unorm"===e)return 16;throw Error(`${e} is not supported!`)}let x=(e,t,i)=>"int32"===i?`atomicAdd(${e}, bitcast<i32>(${t}));`:`
          {
            var oldValue = 0;
            loop {
              let newValueF32 = bitcast<f32>(oldValue) + (${t});
              let newValue = bitcast<i32>(newValueF32);
              let res = atomicCompareExchangeWeak(${e}, oldValue, newValue);
              if res.exchanged {
                break;
              }
              oldValue = res.old_value;
            }
          }`;!function(e){e[e.FROM_PIXELS=0]="FROM_PIXELS",e[e.DRAW=1]="DRAW"}(a||(a={}));let y=(e,t,i,r,s)=>{let o=function(e,t,i){var r;let s;let o=[],n=i.workgroupSize[0]*i.workgroupSize[1]*i.workgroupSize[2];if(i.outputComponent=i.outputComponent?i.outputComponent:1,o.push(`

      var<private> localId: vec3<u32>;
      var<private> localIndex: u32;
      var<private> globalId: vec3<u32>;
      var<private> numWorkgroups: vec3<u32>;
      var<private> workgroupId: vec3<u32>;

      // Only used when the y/z dimension of workgroup size is 1.
      fn getGlobalIndex() -> i32 {
        ${$(i)?"  return i32(globalId.x);":`  return i32((workgroupId.z * numWorkgroups.x * numWorkgroups.y +
                workgroupId.y * numWorkgroups.x + workgroupId.x) * ${n}u +
                localIndex);
        `}
      }
    `),null!=i.pixelsOpType){let r=i.pixelsOpType===a.FROM_PIXELS?`@group(0) @binding(0) var<storage, read_write> result: array<${P(t.dtype,i.outputComponent)}>;`:`@group(0) @binding(1) var<storage, read> inBuf : array<${P(e[0].dtype,i.outputComponent)}>;`,s=3===t.shape.length?"vec2<i32>":"i32";o.push(`
        struct Uniform {
          outShapeStrides : ${s},
          size            : i32,
          numChannels     : i32,
          alpha           : f32,
        };

        ${r}
        @group(0) @binding(2) var<uniform> uniforms: Uniform;
      `);let n=z(i);return[I,o.join("\n"),R(t.shape),i.getUserCode(),v(n,i)].join("\n")}let u="struct Uniforms { NAN : f32, INFINITY : f32, ";i.variableNames.forEach((t,i)=>{let r=b(e[i].shape.length);u+=`${t.charAt(0).toLowerCase()+t.slice(1)}Shape : ${r}, `,s=b(e[i].shape.length-1),u+=`${t.charAt(0).toLowerCase()+t.slice(1)}ShapeStrides: ${s}, `});let l=b(t.shape.length);u+=`outShape : ${l}, `,s=b(t.shape.length-1),u+=`
         outShapeStrides: ${s}, `,i.size&&(u+="size : i32, "),i.uniforms&&(u+=i.uniforms),u+="};",u=u.replace(/(\w+)\s*:\s*vec(5|6)/g,e=>"@align(16) "+e).replace(/vec(5|6)\s*,\s*(\w+)/g,(e,t,i)=>`vec${t}, @align(16) ${i}`),o.push(u),i.atomic?o.push(`
      @group(0) @binding(0) var<storage, read_write> result: array<atomic<i32>>;
    `):o.push(`
      @group(0) @binding(0) var<storage, read_write> result: array<${P(t.dtype,i.outputComponent)}>;
    `),i.variableNames.forEach((t,r)=>{o.push(`
      @group(0) @binding(${1+r}) var<storage, read> ${t}: array<${i.variableComponents?P(e[r].dtype,i.variableComponents[r]):P(e[r].dtype,i.outputComponent)}>;
        `)}),""!==u&&o.push(`
      @group(0) @binding(${1+i.variableNames.length}) var<uniform> uniforms: Uniforms;
      `);let h=function(e,t){let{x:i,y:r=[],z:a=[]}=t,s=e.length,o=i.length+r.length+a.length;if(o!==s)return"";if(i.length===s){let e=b(s);return`fn getOutputCoords() -> ${e}{
    let globalIndex = getGlobalIndex();
    return getCoordsFromIndex(globalIndex);
  }
  `}let n="",u=[i,r,a];for(let e=0;e<u.length;e++){let t=u[e];if(0!==t.length){if(1===t.length)n+=`let d${t[0]} = i32(globalId[${e}]);`;else{let i=function(e,t){if(Math.max(...e)>5)throw Error("Cannot symbolically compute strides for rank > 6 tensor.");let i=e.length,r=e.map(e=>`${t}.${"xyzwuv"[e]}`),a=Array(i-1);a[i-2]=r[i-1];for(let e=i-3;e>=0;--e)a[e]=`(${a[e+1]} * ${r[e+1]})`;return a}(t,"uniforms.outShape");n+=`var index${e} = i32(globalId[${e}]);`;for(let r=0;r<i.length;r++)n+=`let d${t[r]} = index${e} / ${i[r]};`,r===i.length-1?n+=`let d${t[r+1]} = index${e} - d${t[r]} * ${i[r]};`:n+=`index${e} = index${e} - d${t[r]} * ${i[r]};`}}}let l=[];for(let e=0;e<o;e++)l.push(`d${e}`);let d=b(o),h=`fn getOutputCoords() -> ${d} {
  ${n}
`;return 0===l.length?h+=`return ${d}(0); }`:h+=`return ${d}(${l.join(",")}); }`,h}(t.shape,i.dispatchLayout),p=[I,o.join("\n")+k,R(t.shape),h,function(e){let t="";switch(e){case 0:case 1:t+=`
        fn getOutputIndexFromCoords(coords : i32) -> i32 {
          return coords;
        }
        `;break;case 2:t+=`
        fn getOutputIndexFromCoords(coords : vec2<i32>) -> i32 {
          return dot(coords, vec2<i32>(uniforms.outShapeStrides, 1));
        }
        `;break;case 3:t+=`
        fn getOutputIndexFromCoords(coords : vec3<i32>) -> i32 {
          return dot(coords, vec3<i32>(uniforms.outShapeStrides.x, uniforms.outShapeStrides.y, 1));
        }
        `;break;case 4:t+=`
        fn getOutputIndexFromCoords(coords : vec4<i32>) -> i32 {
          return dot(coords, vec4<i32>(
            uniforms.outShapeStrides.x, uniforms.outShapeStrides.y, uniforms.outShapeStrides.z, 1));
        }
        `;break;case 5:t+=`
        fn getOutputIndexFromCoords(coords : vec5) -> i32 {
          return coords.x * uniforms.outShapeStrides.x +
              coords.y * uniforms.outShapeStrides.y +
              coords.z * uniforms.outShapeStrides.z +
              coords.w * uniforms.outShapeStrides.w +
              coords.u;
        }
        `;break;case 6:t+=`
        fn getOutputIndexFromCoords(coords : vec6) -> i32 {
          return coords.x * uniforms.outShapeStrides.x +
              coords.y * uniforms.outShapeStrides.y +
              coords.z * uniforms.outShapeStrides.z +
              coords.w * uniforms.outShapeStrides.w +
              coords.u * uniforms.outShapeStrides.u +
              coords.v;
        }
        `;break;default:d.util.assert(!1,()=>`Unsupported ${e}D shape`)}return t}(t.shape.length)];i.atomic||p.push(function(e,t,i){let r=e.length,a=P(t,i),s=`fn setOutputAtIndex(flatIndex : i32, value : ${w(i)}) {
      result[flatIndex] = ${a}(value);
    }

    fn setOutputAtIndexI32(flatIndex : i32, value : ${w(i,"i32")}) {
      result[flatIndex] = ${a}(value);
    }
    `;if(r>=2){let e=["d0","d1","d2","d3","d4","d5"].slice(0,r),t=b(r);s+=`
      fn setOutputAtCoords(${e.map(e=>`${e} : i32`).join(", ")}, value : ${w(i)}) {
        let flatIndex = getOutputIndexFromCoords(${t}(${e.join(", ")}));
        setOutputAtIndex(flatIndex${1===i?"":` / ${i}`}, value);
      }
      fn setOutputAtCoordsI32(${e.map(e=>`${e} : i32`).join(", ")}, value : ${w(i,"i32")}) {
        let flatIndex = getOutputIndexFromCoords(${t}(${e.join(", ")}));
        setOutputAtIndexI32(flatIndex${1===i?"":` / ${i}`}, value);
      }
    `}return s}(t.shape,t.dtype,i.outputComponent)),i.variableNames.forEach((t,i)=>{p.push(`${R(e[i].shape,t)}`)});let c=e.map((e,r)=>{var a,s,o;let n;return a=t.shape,s=i.variableComponents?i.variableComponents[r]:i.outputComponent,o=i.dispatchLayout.x.length===t.shape.length,n=function(e,t){let i=e.name,r=e.shape.length,a=b(r),s="get"+i.charAt(0).toUpperCase()+i.slice(1),o=["d0","d1","d2","d3","d4","d5"].slice(0,r),n=o.map(e=>`${e} : i32`).join(", ");if(r<1)return`
      fn ${s}() -> ${w(t)} {
        return ${w(t)}(${i}[0]);
      }
    `;let u=`uniforms.${i.charAt(0).toLowerCase()+i.slice(1)}Shape`,l=`${r}D`;return 0===r&&(l="1D"),`
    fn ${s}(${n}) -> ${w(t)} {
      return ${w(t)}(${i}[getIndexFromCoords${l}(${a}(${o.join(",")}),
        ${u})${1===t?"":` / ${t}`}]);
    }
   `}(e,s),e.shape.length<=a.length&&(n+=function(e,t,i,r){let a=e.name,s=a.charAt(0).toUpperCase()+a.slice(1),o="get"+s+"ByOutput",n=e.shape.length,u=t.length,l=b(u);if(d.util.arraysEqual(e.shape,t)&&r)return`
    fn ${o}Index(globalIndex : i32) -> ${w(i)} {
      return ${w(i)}(${a}[globalIndex]);
    }

    fn ${o}Coords(coords : ${l}) -> ${w(i)} {
      return ${w(i)}(${a}[${u>1?"getOutputIndexFromCoords(coords)":"coords"}${1===i?"":` / ${i}`}]);
    }
    `;let h=d.backend_util.getBroadcastDims(e.shape,t),p=u-n,c="";if(0===n)return`
    fn ${o}Index(globalIndex : i32) -> ${w(i)}{
      return get${s}();
    }

    fn ${o}Coords(coords : ${l}) -> ${w(i)}{
      return get${s}();
    }
  `;c=u<2&&h.length>=1?"coords = 0;":h.map(e=>`coords.${C(e+p)} = 0;`).join("\n");let f="";if(u<2&&n>0)f="coords";else if(u>1){let t=b(n),i=e.shape.map((e,t)=>`coords.${C(t+p)}`).join(", ");f=`${t}(${i})`}else f="coords";let m=`uniforms.${a.charAt(0).toLowerCase()+a.slice(1)}Shape`,g=`${n}D`;return`
  fn ${o}Index(globalIndex : i32) -> ${w(i)} {
    var coords = getCoordsFromIndex(globalIndex);
    ${c}
    return ${w(i)}(${a}[getIndexFromCoords${g}(${f}, ${m})${1===i?"":` / ${i}`}]);
  }

  fn ${o}Coords(coordsIn : ${l}) -> ${w(i)} {
    var coords = coordsIn;
    ${c}
    return ${w(i)}(${a}[getIndexFromCoords${g}(${f}, ${m})${1===i?"":` / ${i}`}]);
  }
`}(e,a,s,o)),n}).join("\n");p.push(c),p.push(i.getUserCode());let f=z(i);return p.push(v(f,i)),p.join("\n")}(i,{dtype:r.dtype,shape:r.shape},t),n=e.createShaderModule({code:o,label:t.constructor.name}),u=(0,d.env)().get("WEBGPU_PRINT_SHADER");if(""!==u){let e=(u=u.toLowerCase()).split(",");("all"===u||e.some(e=>t.shaderKey.toLowerCase().includes(e)))&&(console.group(t.shaderKey),console.debug(o),console.groupEnd())}return s?e.createComputePipelineAsync({compute:{module:n,entryPoint:"_start"},label:t.constructor.name,layout:"auto"}):e.createComputePipeline({compute:{module:n,entryPoint:"_start"},label:t.constructor.name,layout:"auto"})},w=(e,t="f32")=>{switch(e){case 1:return`${t}`;case 2:return`vec2<${t}>`;case 3:return`vec3<${t}>`;case 4:return`vec4<${t}>`;default:throw Error(`${e}-component ${t} is not supported.`)}};function b(e){if(e<=1)return"i32";if(2===e)return"vec2<i32>";if(3===e)return"vec3<i32>";if(4===e)return"vec4<i32>";if(5===e)return"vec5";if(6===e)return"vec6";throw Error(`GPU for rank ${e} is not yet supported`)}function C(e){if(0===e)return"x";if(1===e)return"y";if(2===e)return"z";if(3===e)return"w";if(4===e)return"u";if(5===e)return"v";throw Error(`Index ${e} is not yet supported`)}function S(...e){let t;switch(e.length){case 0:t=`
        fn main()
      `;break;case 1:t=`
        fn main(${e[0]} : i32)
      `;break;default:throw Error("Unreachable")}return t}function v(e,t){return`
     
  @compute @workgroup_size(${t.workgroupSize[0]}, ${t.workgroupSize[1]}, ${t.workgroupSize[2]})

      fn _start(@builtin(local_invocation_id) LocalId : vec3<u32>,
                @builtin(global_invocation_id) GlobalId : vec3<u32>,
                @builtin(local_invocation_index) LocalIndex: u32,
                @builtin(workgroup_id) WorkgroupId : vec3<u32>,
                @builtin(num_workgroups) NumWorkgroups : vec3<u32>) {
        localId = LocalId;
        localIndex = LocalIndex;
        globalId = GlobalId;
        numWorkgroups = NumWorkgroups;
        workgroupId = WorkgroupId;
        ${e?"main(getGlobalIndex());":"main();"};
      }
    `}let I=`
  struct vec5 {x: i32, y: i32, z: i32, w: i32, u: i32};
  struct vec6 {x: i32, y: i32, z: i32, w: i32, u: i32, v: i32};

  // Checks whether coordinates lie within the bounds of the shape.
  fn coordsInBounds2D(coord : vec2<i32>, shape : vec2<i32>) -> bool {
    return all(coord >= vec2<i32>(0)) && all(coord < shape);
  }
  fn coordsInBounds3D(coord : vec3<i32>, shape : vec3<i32>) -> bool {
    return all(coord >= vec3<i32>(0)) && all(coord < shape);
  }
  fn coordsInBounds4D(coord : vec4<i32>, shape : vec4<i32>) -> bool {
    return all(coord >= vec4<i32>(0)) && all(coord < shape);
  }

  fn getIndexFromCoords1D(coord : i32, shape : i32) -> i32 {
    return coord;
  }
  fn getIndexFromCoords2D(coords : vec2<i32>, shape : vec2<i32>) -> i32 {
    return dot(coords, vec2<i32>(shape.y, 1));
  }
  fn getIndexFromCoords3D(coords : vec3<i32>, shape : vec3<i32>) -> i32 {
    return dot(coords, vec3<i32>(shape.y * shape.z, shape.z, 1));
  }
  fn getIndexFromCoords4D(coords : vec4<i32>, shape : vec4<i32>) -> i32 {
    return dot(coords, vec4<i32>(
        shape.y * shape.z * shape.w, shape.z * shape.w, shape.w, 1));
  }
  fn getIndexFromCoords5D(coords : vec5, shape : vec5) -> i32 {
    let shapeStrides: vec5 = vec5(shape.y * shape.z * shape.w * shape.u, shape.z * shape.w * shape.u, shape.w * shape.u, shape.u, 1);
    return coords.x*shapeStrides.x + coords.y*shapeStrides.y + coords.z*shapeStrides.z + coords.w*shapeStrides.w + coords.u*shapeStrides.u;
  }
  fn getIndexFromCoords6D(coords : vec6, shape : vec6) -> i32 {
    let shapeStrides: vec6 = vec6(shape.y * shape.z * shape.w * shape.u * shape.v, shape.z * shape.w * shape.u * shape.v, shape.w * shape.u * shape.v, shape.u * shape.v, shape.v, 1);
    return coords.x*shapeStrides.x + coords.y*shapeStrides.y + coords.z*shapeStrides.z + coords.w*shapeStrides.w + coords.u*shapeStrides.u + coords.v*shapeStrides.v;
  }

  // NaN defination in IEEE 754-1985 is :
  //   - sign = either 0 or 1.
  //   - biased exponent = all 1 bits.
  //   - fraction = anything except all 0 bits (since all 0 bits represents infinity).
  // https://en.wikipedia.org/wiki/IEEE_754-1985#Representation_of_non-numbers
  fn isnan(val: f32) -> bool {
    let floatToUint: u32 = bitcast<u32>(val);
    return (floatToUint & 0x7fffffffu) > 0x7f800000u;
  }
  fn isnanVec4(val : vec4<f32>) -> vec4<bool> {
    let floatToUint: vec4<u32> = bitcast<vec4<u32>>(val);
    return (floatToUint & vec4<u32>(0x7fffffffu)) > vec4<u32>(0x7f800000u);
  }
`,k=`
  fn isinf(val: f32) -> bool {
    return abs(val) == uniforms.INFINITY;
  }
`;function R(e,t=""){let i;let r=e.length,a=""!==t?`get${t.charAt(0).toUpperCase()+t.slice(1)}CoordsFromIndex`:"getCoordsFromIndex",s=""!==t?`${t.charAt(0).toLowerCase()+t.slice(1)}ShapeStrides`:"outShapeStrides";if(r<=1)return`fn ${a}(index : i32) -> i32 { return index; }`;let o=d.util.computeStrides(e),n=b(r),u=[];for(let e=0;e<r;e++)u.push(`d${e}`);return 1===o.length?`    fn ${a}(index : i32) -> vec2<i32> {
      let d0 = index / uniforms.${s}; let d1 = index - d0 * uniforms.${s};
      return vec2<i32>(d0, d1);
    }`:(i="var index2 = index;"+o.map((e,t)=>{let i=`let ${u[t]} = index2 / uniforms.${s}.${C(t)}`,r=t===o.length-1?`let ${u[t+1]} = index2 - ${u[t]} * uniforms.${s}.${C(t)}`:`index2 = index2 - ${u[t]} * uniforms.${s}.${C(t)}`;return`${i}; ${r};`}).join(""),`
    fn ${a}(index : i32) -> ${n} {
      ${i}
      return ${n}(${u.join(",")});
    }
  `)}function $(e){return 1===e.dispatch[1]&&1===e.dispatch[2]}function P(e,t=1){if("float32"===e)return w(t,"f32");if("int32"===e||"bool"===e)return w(t,"i32");throw Error(`type ${e} is not supported.`)}function z(e){return!(e.dispatchLayout.hasOwnProperty("y")&&0!==e.dispatchLayout.y.length||e.dispatchLayout.hasOwnProperty("z")&&0!==e.dispatchLayout.z.length)}let N=e=>{let t=1;for(let i=0;i<e.length;i++)t*=e[i];return t};function A(e,t){if(e.length!==t.length)throw Error(`Cannot compute whether rank ${e.length} tiles fit evenly into rank ${t.length} shape - ranks must match.`);return t.every((t,i)=>t%e[i]==0)}function D(e,t,i=[1,1,1],r=[1,1,1]){let[a,s,o]=[Math.ceil(N(e.x.map(e=>t[e]))/(i[0]*r[0])),e.y?Math.ceil(N(e.y.map(e=>t[e]))/(i[1]*r[1])):1,e.z?Math.ceil(N(e.z.map(e=>t[e]))/(i[2]*r[2])):1];return[a,s,o]}function F(e,t,i,r=!1){let a=[8,8,1],s=[4,4,1];return!r&&(e<=8&&(s[1]=1),t<=16&&i<=16&&(a[0]=4)),{workgroupSize:a,elementsPerThread:s}}function _(e,t,i=!1){if(i)return[8,8,1];let r=N(e.x.map(e=>t[e])),a=N(e.y.map(e=>t[e]));return r<=4?[4,16,1]:a<=4?[16,4,1]:[16,16,1]}function T(e,t,i=!1){if(i)return[4,4,1];let r=N(e.x.map(e=>t[e])),a=N(e.y.map(e=>t[e]));return r<=4?[1,2,1]:a<=4?[2,1,1]:[2,2,1]}function L(e){return{x:e.map((e,t)=>t)}}function E(e){if("float32"===e||"int32"===e||"bool"===e||"string"===e)return 4;if("complex64"===e)return 8;throw Error(`Unknown dtype ${e}`)}function B(){return!!("undefined"!=typeof globalThis&&globalThis.navigator&&globalThis.navigator.gpu)}function W(e,t){Array.isArray(e)||(e=[e]),e.forEach(e=>{null!=e&&d.util.assert("complex64"!==e.dtype,()=>`${t} does not support complex64 tensors in the WebGPU backend.`)})}!function(e){e[e.MatMulReduceProgram=0]="MatMulReduceProgram",e[e.MatMulSplitKProgram=1]="MatMulSplitKProgram",e[e.MatMulSmallOutputSizeProgram=2]="MatMulSmallOutputSizeProgram",e[e.MatMulPackedProgram=3]="MatMulPackedProgram",e[e.MatMulMax=4]="MatMulMax"}(s||(s={}));let O=(0,d.env)().getNumber("WEBGPU_CPU_HANDOFF_SIZE_THRESHOLD"),U=(e,t)=>{let i=e.limits.maxComputeWorkgroupsPerDimension,r=t.dispatchLayout,a=t.dispatch;if(a.every(e=>e<=i))return a;d.util.assert(a[0]>i&&void 0===r.y&&void 0===r.z,()=>"Dispatch size exceeds WebGPU limits in Y or Z dimension.");let s=Math.ceil(Math.sqrt(a[0]));return s>i?(s=Math.ceil(Math.cbrt(a[0])),d.util.assert(s<=i,()=>"Total dispatch size exceeds WebGPU maximum."),[s,s,s]):[s,s,1]};class V extends d.KernelBackend{nextDataId(){return V.nextDataId++}constructor(e,t){if(super(),this.commandQueueOwnedIds=new WeakSet,this.dispatchCountInPass=0,this.disposed=!1,this.downloadWaitMs=0,this.tensorDataPendingDisposal=[],this.queryResolveBuffer=null,this.querySet=null,this.querySetCount=2,this.stagingPendingDisposal=[],this.uniformPendingDisposal=[],this.uploadWaitMs=0,this.hasReadSyncWarned=!1,this.hasTimestampQueryWarned=!1,!B())throw Error("WebGPU is not supported on this device");this.pipelineCache={},this.device=e,this.queue=e.queue,this.commandEncoder=null,this.computePassEncoder=null,this.adapterInfo=new p(t),this.supportTimestampQuery=this.device.features.has("timestamp-query"),this.thresholdToIncreaseWorkgroups=this.adapterInfo.intelGPUGeneration>=12?16:8,this.bufferManager=new c(this.device),this.textureManager=new f(this.device),this.tensorMap=new d.DataStorage(this,(0,d.engine)()),(0,d.env)().getBool("WEBGPU_USE_PROFILE_TOOL")&&(this.dummyCanvas=document.createElement("canvas"),this.dummyCanvas.width=1,this.dummyCanvas.height=1,this.dummyContext=this.dummyCanvas.getContext("webgpu"),this.dummyContext.configure({device:e,format:"bgra8unorm"}),document.body.appendChild(this.dummyCanvas))}floatPrecision(){return 32}disposeData(e,t=!1){if(!this.tensorMap.has(e))return!0;let i=this.tensorMap.get(e);return t?i.refCount=0:i.refCount--,!(i.refCount>0)&&((null!=i.complexTensorInfos&&(this.disposeData(i.complexTensorInfos.real.dataId),this.disposeData(i.complexTensorInfos.imag.dataId)),this.commandQueueOwnedIds.has(e))?this.tensorDataPendingDisposal.push(e):(this.releaseResource(e),this.tensorMap.delete(e)),!0)}memory(){return{numBytesInGPU:this.bufferManager.numBytesUsed,numBytesAllocatedInGPU:this.bufferManager.numBytesAllocated,unreliable:!1}}releaseResource(e){let t=this.tensorMap.get(e);if(t&&t.resource){if(t.external){t.resource=null;return}t.resource instanceof GPUBuffer?this.bufferManager.releaseBuffer(t.resource):t.resource instanceof GPUTexture&&this.textureManager.releaseTexture(t.resource),t.resource=null}}refCount(e){return this.tensorMap.has(e)?this.tensorMap.get(e).refCount:0}incRef(e){let t=this.tensorMap.get(e);t.refCount++}decRef(e){if(this.tensorMap.has(e)){let t=this.tensorMap.get(e);t.refCount--}}write(e,t,i){if("complex64"===i&&null!=e)throw Error("Cannot write to a complex64 dtype. Please use tf.complex(real, imag).");let r={id:this.nextDataId()};return this.tensorMap.set(r,{dtype:i,shape:t,values:e,refCount:1}),r}move(e,t,i,r,a){if("complex64"===r)throw Error("Cannot write to a complex64 dtype. Please use tf.complex(real, imag).");this.tensorMap.set(e,{dtype:r,shape:i,values:t,refCount:a})}submitQueue(){this.queue.submit([this.commandEncoder.finish()]),this.commandEncoder=null,this.dispatchCountInPass=0,this.commandQueueOwnedIds=new WeakSet,this.tensorDataPendingDisposal.forEach(e=>{this.releaseResource(e),this.tensorMap.delete(e)}),this.uniformPendingDisposal.forEach(e=>this.bufferManager.releaseBuffer(e)),this.stagingPendingDisposal.forEach(e=>this.bufferManager.releaseBuffer(e,!1)),this.tensorDataPendingDisposal=[],this.uniformPendingDisposal=[],this.stagingPendingDisposal=[]}ensureCommandEncoderReady(){this.commandEncoder||(this.commandEncoder=this.device.createCommandEncoder())}endComputePassEncoder(){this.computePassEncoder&&(this.computePassEncoder.end(),this.computePassEncoder=null)}async checkCompileCompletionAsync(){let e;try{e=await Promise.all(Object.values(this.pipelineCache))}catch(e){throw Error(e.message)}Object.keys(this.pipelineCache).map((t,i)=>{this.pipelineCache[t]=e[i]})}async getBufferData(e){if((0,d.env)().getBool("WEBGPU_ENGINE_COMPILE_ONLY"))return console.warn("The data may be invalid since WEBGPU_ENGINE_COMPILE_ONLY is true, this can only be called when WEBGPU_ENGINE_COMPILE_ONLY is false"),null;let t=e.size,i=this.bufferManager.acquireBuffer(t,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(e,0,i,0,t),this.submitQueue(),await i.mapAsync(GPUMapMode.READ);let r=i.getMappedRange().slice(0);return i.unmap(),null!=i&&this.bufferManager.releaseBuffer(i),(0,d.env)().getBool("WEBGPU_USE_PROFILE_TOOL")&&(d.util.assert(void 0!==this.dummyContext,()=>"Fail to get context for profiling tool"),this.dummyContext.getCurrentTexture()),r}convertAndCacheOnCPU(e,t){let i=this.tensorMap.get(e);return i.values=t,i.values}readSync(e){let t=this.tensorMap.get(e),{values:i,complexTensorInfos:r}=t;if(null!=i||"string"===t.dtype)return i;if("complex64"===t.dtype){let t=this.readSync(r.real.dataId),i=this.readSync(r.imag.dataId),a=d.util.convertBackendValuesAndArrayBuffer(d.backend_util.mergeRealAndImagArrays(t,i).buffer,"float32");return this.convertAndCacheOnCPU(e,a),a}this.hasReadSyncWarned||(this.hasReadSyncWarned=!0,console.warn("The performance of synchronously reading data from GPU to CPU is poor on the webgpu backend, please use asynchronous APIs instead."));let a=["opaque","premultiplied"],s=t.resource,o=s.size;d.util.assert(o%4==0,()=>"Because there is 4 bytes for one pixel, buffer size must be multiple of 4.");let n=o/4,u=new ArrayBuffer(o),l=a.map(e=>new OffscreenCanvas(256,256)),h=new OffscreenCanvas(256,256);this.endComputePassEncoder(),l.map((e,t)=>{let i=e.getContext("webgpu");return i.configure({device:this.device,format:"bgra8unorm",usage:GPUTextureUsage.COPY_DST,alphaMode:a[t]}),i.getCurrentTexture()}).map((e,t)=>{let i=(i,r,o)=>{this.ensureCommandEncoderReady(),this.commandEncoder.copyBufferToTexture({buffer:s,bytesPerRow:1024,offset:o},{texture:e},{width:i,height:r}),this.submitQueue();let n=h.getContext("2d",{willReadFrequently:!0});n.clearRect(0,0,i,r),n.drawImage(l[t],0,0);let d=n.getImageData(0,0,i,r).data,p=a[t],c=new Uint8ClampedArray(u,o,i*r*4);for(let e=0;e<c.length;e+=4)if("premultiplied"===p)c[e+3]=d[e+3];else{let t=d[e];c[e]=d[e+2],c[e+1]=d[e+1],c[e+2]=t}},r=Math.floor(n/65536),o=256,d=256,p=0;for(let e=0;e<r;e++)i(o,d,p),p+=262144;let c=n%65536;(d=Math.floor(c/256))>0&&(i(o,d,p),p+=1024*d),(o=c%256)>0&&i(o,1,p)});let p=d.util.convertBackendValuesAndArrayBuffer(u,t.dtype);return this.convertAndCacheOnCPU(e,p),p}async read(e){let t;if(!this.tensorMap.has(e))throw Error(`Tensor ${e} was not registered!`);let i=this.tensorMap.get(e),{values:r}=i;if(null!=r)return r;if("complex64"===i.dtype){let e=await Promise.all([this.read(i.complexTensorInfos.real.dataId),this.read(i.complexTensorInfos.imag.dataId)]),r=e[0],a=e[1];t=d.backend_util.mergeRealAndImagArrays(r,a)}else{let e=await this.getBufferData(i.resource);t=d.util.convertBackendValuesAndArrayBuffer(e,i.dtype)}return this.convertAndCacheOnCPU(e,t),t}copyBuffer(e){let t=e.size,i=e.usage,r=this.bufferManager.acquireBuffer(t,i);return this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(e,0,r,0,t),this.submitQueue(),r}createTensorFromGPUData(e,t,i){let r=e.buffer;if("complex64"===i)throw Error("Cannot write to a complex64 dtype. ");let a={id:this.nextDataId()};this.tensorMap.set(a,{dtype:i,shape:t,values:null,refCount:1,external:e.zeroCopy});let s=this.tensorMap.get(a),o=E(s.dtype)*d.util.sizeFromShape(s.shape);if(e.buffer.size<o)throw Error(`GPUBuffer size(${e.buffer.size}) is smaller than tensor size(${o})!`);if((e.buffer.usage&(GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC))!=(GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC))throw Error("GPUBuffer.usage should include GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC!");return!0!==e.zeroCopy&&(r=this.copyBuffer(r)),s.resource=r,(0,d.engine)().makeTensorFromDataId(a,t,i,this)}readToGPU(e){let{values:t,dtype:i,shape:r,resource:a}=this.tensorMap.get(e);if("complex64"===i)throw Error("Does not support reading buffer for complex64 dtype.");if(null==a){if(null!=t)throw Error("Data is not on GPU but on CPU.");throw Error("There is no data on GPU or CPU.")}let s=a.size,o=a.usage,n=this.bufferManager.acquireBuffer(s,o);this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(a,0,n,0,s),this.submitQueue();let u=this.makeTensorInfo(r,i),l=(0,d.engine)().makeTensorFromTensorInfo(u);return this.tensorMap.get(u.dataId).resource=n,{tensorRef:l,buffer:n}}bufferSync(e){let t=this.readSync(e.dataId);if("string"===e.dtype)try{let i=t.map(e=>d.util.decodeString(e));return(0,d.buffer)(e.shape,e.dtype,i)}catch(e){throw Error("Failed to decode encoded string bytes into utf-8")}return(0,d.buffer)(e.shape,e.dtype,t)}async time(e){this.supportTimestampQuery||this.hasTimestampQueryWarned||(console.warn("This device doesn't support timestamp-query extension. Start Chrome browser with flag --enable-dawn-features=allow_unsafe_apis to try it again. Otherwise, zero will be shown for the kernel time when profiling mode is enabled."),this.hasTimestampQueryWarned=!0);let t=this.activeTimers,i=[],r=!1;null==this.programTimersStack?(this.programTimersStack=i,r=!0):this.activeTimers.push(i),this.activeTimers=i,e();let a=d.util.flatten(this.activeTimers.map(e=>e.query)).filter(e=>null!=e),s=d.util.flatten(this.activeTimers.map(e=>e.name)).filter(e=>null!=e);this.activeTimers=t,r&&(this.programTimersStack=null);let o={uploadWaitMs:this.uploadWaitMs,downloadWaitMs:this.downloadWaitMs,kernelMs:null,wallMs:null},n=await Promise.all(a);return o.kernelMs=d.util.sum(n),o.getExtraProfileInfo=()=>n.map((e,t)=>({name:s[t],ms:e})).map(e=>`${e.name}: ${e.ms}`).join(", "),this.uploadWaitMs=0,this.downloadWaitMs=0,o}makeTensorInfo(e,t,i){return"string"===t&&null!=i&&i.length>0&&d.util.isString(i[0])&&(i=i.map(e=>d.util.encodeString(e))),{dataId:this.write(i,e,t),shape:e,dtype:t}}tensorToBinding(e){if(!e)return null;let t=this.tensorMap.get(e.dataId).resource;return t instanceof GPUBuffer?{buffer:t}:t instanceof GPUTexture?t.createView():t}uploadToGPU(e){let t;let i=this.tensorMap.get(e);if(null!=i.resource)return;let r=E(i.dtype)*d.util.sizeFromShape(i.shape),a=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;if(i.values){if("unmapped"===(t=this.bufferManager.acquireBuffer(r,a,!0)).mapState){let e=this.bufferManager.acquireBuffer(r,GPUBufferUsage.MAP_WRITE|GPUBufferUsage.COPY_SRC,!0,!1),a=e.getMappedRange();"int32"===i.dtype||"bool"===i.dtype?new Int32Array(a).set(i.values):new Float32Array(a).set(i.values),e.unmap(),this.ensureCommandEncoderReady(),this.endComputePassEncoder(),this.commandEncoder.copyBufferToBuffer(e,0,t,0,r),this.stagingPendingDisposal.push(e)}else{let e=t.getMappedRange();"int32"===i.dtype||"bool"===i.dtype?new Int32Array(e).set(i.values):new Float32Array(e).set(i.values),t.unmap()}i.values=null}else t=this.bufferManager.acquireBuffer(r,a);i.resource=t}makeUniforms(e){let t=0,i=0,r=[],a=1;e.forEach(e=>{let s;switch(0===e.data.length&&(e.data=[1]),e.data.length){case 1:s=4;break;case 2:s=8;break;case 3:case 4:case 5:case 6:s=16;break;default:d.util.assert(!1,()=>`Unsupported ${e.data.length}D shape`)}(5===i||6===i)&&(s=16),s>a&&(a=s),t=Math.ceil(t/s)*s,i=e.data.length,r.push(t),t+=4*e.data.length});let s=new ArrayBuffer(t=Math.ceil(t/a)*a);e.forEach((e,t)=>{let i=r[t];"int32"===e.type?new Int32Array(s,i,e.data.length).set(e.data):"uint32"===e.type?new Uint32Array(s,i,e.data.length).set(e.data):new Float32Array(s,i,e.data.length).set(e.data)});let o=this.bufferManager.acquireBuffer(t,GPUBufferUsage.COPY_DST|GPUBufferUsage.UNIFORM);return this.queue.writeBuffer(o,0,s,0,t),this.uniformPendingDisposal.push(o),{offset:0,size:t,buffer:o}}runWebGPUProgram(e,t,i,r,a){if(a||(a=this.makeTensorInfo(e.outputShape,i)),0===d.util.sizeFromShape(a.shape))return this.tensorMap.get(a.dataId).values=d.util.getTypedArrayFromDType(a.dtype,0),a;this.uploadToGPU(a.dataId),e.dispatch=U(this.device,e);let s=t.map((t,i)=>{if("complex64"===t.dtype)throw Error("GPGPUProgram does not support complex64 input. For complex64 dtypes, please separate the program into real and imaginary parts.");return this.uploadToGPU(t.dataId),{dtype:this.tensorMap.get(t.dataId).dtype,shape:t.shape,name:e.variableNames[i]}});e.shaderKey=function(e,t,i){let r=e.shaderKey;if(null!=e.pixelsOpType)return r;let a=[],s=[];t.forEach(e=>{a.push(e.shape),s.push(e.dtype)}),a.push(i.shape),s.push(i.dtype);let o=t.map(e=>d.backend_util.getBroadcastDims(e.shape,i.shape)),n=t.map(e=>d.util.arraysEqual(e.shape,i.shape)).join("_"),u=o.map(e=>e.join("_")).join(";"),l=$(e)?"flatDispatch":"";return r+("_"+(e.workgroupSize?e.workgroupSize.join(","):"")+a.map(e=>e.length).join(",")+s.join(",")+e.variableNames.join(",")+u+n)+l}(e,s,a);let o=(0,d.env)().getBool("WEBGPU_ENGINE_COMPILE_ONLY");return e.shaderKey in this.pipelineCache||(this.pipelineCache[e.shaderKey]=y(this.device,e,s,a,o)),e.pipeline=this.pipelineCache[e.shaderKey],o||this.recordAndSubmit(e,a,t,r),a}recordAndSubmit(e,t,i,r){if(e.pipeline instanceof Promise)throw Error("Please call checkCompileCompletionAsync to ensure parallel compilation is done!");let s=[],o=[],n="int32";if(null==e.pixelsOpType){s.push({type:"float32",data:[NaN]},{type:"float32",data:[1/0]});let e="int32";i.concat(t).map(e=>e.shape).map(t=>{s.push({type:e,data:t});let i=d.util.computeStrides(t);s.push({type:e,data:i})})}else{let e=d.util.computeStrides(t.shape);s.push({type:n,data:e})}if(e.size){let t=d.util.sizeFromShape(e.outputShape);s.push({type:n,data:[e.outputComponent?t/e.outputComponent:t]})}r&&(s=[...s,...r]);let u=[this.tensorToBinding(t),...i.map(e=>this.tensorToBinding(e)),this.makeUniforms(s)];i.forEach(e=>{this.commandQueueOwnedIds.add(e.dataId)}),this.commandQueueOwnedIds.add(t.dataId);let l=this.device.createBindGroup({layout:e.pipeline.getBindGroupLayout(0),entries:u.map((e,t)=>({binding:t,resource:e}))}),h=null!=this.activeTimers;this.ensureCommandEncoderReady();let p={};h&&this.supportTimestampQuery?(this.endComputePassEncoder(),null==this.querySet&&(this.querySet=this.device.createQuerySet({type:"timestamp",count:this.querySetCount})),p.timestampWrites={querySet:this.querySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1},this.computePassEncoder=this.commandEncoder.beginComputePass(p)):this.computePassEncoder||(this.computePassEncoder=this.commandEncoder.beginComputePass(p)),this.computePassEncoder.setPipeline(e.pipeline),this.computePassEncoder.setBindGroup(0,l),this.computePassEncoder.dispatchWorkgroups(e.dispatch[0],e.dispatch[1],e.dispatch[2]),this.dispatchCountInPass++,(h||(0,d.env)().get("WEBGPU_DEFERRED_SUBMIT_BATCH_SIZE")<=this.dispatchCountInPass||e.pixelsOpType===a.DRAW)&&(this.endComputePassEncoder(),h?this.activeTimers.push({name:e.constructor.name,query:this.getQueryTime()}):this.submitQueue())}async getQueryTime(){if(!this.supportTimestampQuery)return 0;null==this.queryResolveBuffer&&(this.queryResolveBuffer=this.bufferManager.acquireBuffer(8*this.querySetCount,GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST|GPUBufferUsage.QUERY_RESOLVE)),this.commandEncoder.resolveQuerySet(this.querySet,0,this.querySetCount,this.queryResolveBuffer,0);let e=this.bufferManager.acquireBuffer(8*this.querySetCount,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);this.commandEncoder.copyBufferToBuffer(this.queryResolveBuffer,0,e,0,8*this.querySetCount),this.submitQueue(),await e.mapAsync(GPUMapMode.READ);let t=new BigUint64Array(e.getMappedRange()),i=Number(t[1]-t[0])/1e6;return e.unmap(),this.bufferManager.releaseBuffer(e),i}shouldExecuteOnCPU(e,t=O){return(0,d.env)().getBool("WEBGPU_CPU_FORWARD")&&e.every(e=>null==this.tensorMap.get(e.dataId).resource&&d.util.sizeFromShape(e.shape)<t)}numDataIds(){return this.tensorMap.numDataIds()-this.tensorDataPendingDisposal.length}dispose(){this.disposed||(null!=this.querySet&&this.querySet.destroy(),this.bufferManager.dispose(),this.textureManager.dispose(),this.disposed=!0)}}V.nextDataId=0,B()&&(0,d.registerBackend)("webgpu",async()=>{let e={powerPreference:(0,d.env)().get("WEBGPU_USE_LOW_POWER_GPU")?"low-power":"high-performance"},t=await navigator.gpu.requestAdapter(e),i={},r=[];t.features.has("timestamp-query")&&r.push("timestamp-query"),t.features.has("bgra8unorm-storage")&&r.push(["bgra8unorm-storage"]),i.requiredFeatures=r;let a=t.limits;return i.requiredLimits={maxComputeWorkgroupStorageSize:a.maxComputeWorkgroupStorageSize,maxComputeWorkgroupsPerDimension:a.maxComputeWorkgroupsPerDimension,maxStorageBufferBindingSize:a.maxStorageBufferBindingSize,maxBufferSize:a.maxBufferSize,maxComputeWorkgroupSizeX:a.maxComputeWorkgroupSizeX,maxComputeInvocationsPerWorkgroup:a.maxComputeInvocationsPerWorkgroup},new V(await t.requestDevice(i),"info"in t?t.info:"requestAdapterInfo"in t?await t.requestAdapterInfo():void 0)},3),function(e){e[e.ADD=0]="ADD",e[e.ATAN2=1]="ATAN2",e[e.COMPLEX_MULTIPLY_IMAG=2]="COMPLEX_MULTIPLY_IMAG",e[e.COMPLEX_MULTIPLY_REAL=3]="COMPLEX_MULTIPLY_REAL",e[e.DIV=4]="DIV",e[e.ELU_DER=5]="ELU_DER",e[e.EQUAL=6]="EQUAL",e[e.FLOOR_DIV=7]="FLOOR_DIV",e[e.GREATER=8]="GREATER",e[e.GREATER_EQUAL=9]="GREATER_EQUAL",e[e.LESS=10]="LESS",e[e.LESS_EQUAL=11]="LESS_EQUAL",e[e.LOGICAL_AND=12]="LOGICAL_AND",e[e.LOGICAL_OR=13]="LOGICAL_OR",e[e.MAX=14]="MAX",e[e.MIN=15]="MIN",e[e.MOD=16]="MOD",e[e.MUL=17]="MUL",e[e.NOT_EQUAL=18]="NOT_EQUAL",e[e.POW=19]="POW",e[e.PRELU=20]="PRELU",e[e.SQUARED_DIFFERENCE=21]="SQUARED_DIFFERENCE",e[e.SUB=22]="SUB"}(o||(o={}));let M=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a == b);
`,G=`
  let remainder =
      select(a % b, round(a % b), (round(a) == a) & (round(b) == b));
  let quotient = (a - remainder) / b;
  let resultTemp =
      round(select(quotient, quotient - 1, sign(remainder) == -sign(b)));
`,H=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a > b);
`,X=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a >= b);
`,K=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a < b);
`,q=`
  let zero = sign(a) * 0 + 0;
  let one = sign(b) * 0 + 1;
  let resultTemp = select(zero, one, a <= b);
`,Y=`return (vec4<f32>(a >= vec4<f32>(1.0)) *
  vec4<f32>(b >= vec4<f32>(1.0)));`,j=`return min(vec4<f32>(a >= vec4<f32>(1.0)) +
  vec4<f32>(b >= vec4<f32>(1.0)), vec4<f32>(1.0));`,Q=`
  let isNaN = b == 0.;
  var resultTemp = a % b;
  resultTemp = select((resultTemp + b) % b, resultTemp,
      (a < 0. && b < 0.) || (a >= 0. && b > 0.));
`,Z=`
  let isNaN = !vec4<bool>(b);
  var resultTemp = vec4<f32>(a % b);
  if (!((a[0] < 0. && b[0] < 0.) || (a[0] >= 0. && b[0] > 0.))) {
    resultTemp[0] = (resultTemp[0] + b[0]) % b[0];
  }
  if (!((a[1] < 0. && b[1] < 0.) || (a[1] >= 0. && b[1] > 0.))) {
    resultTemp[1] = (resultTemp[1] + b[1]) % b[1];
  }
  if (!((a[2] < 0. && b[2] < 0.) || (a[2] >= 0. && b[2] > 0.))) {
    resultTemp[2] = (resultTemp[2] + b[2]) % b[2];
  }
  if (!((a[3] < 0. && b[3] < 0.) || (a[3] >= 0. && b[3] > 0.))) {
    resultTemp[3] = (resultTemp[3] + b[3]) % b[3];
  }
`,J=`
  var resultTemp = f32(a != b);
  let valueForNaN = 1.0;
`,ee=`
  var resultTemp = vec4<f32>(a != b);
  let valueForNaN = 1.0;
`,et=`
  let isNaN = a < 0.0 && floor(b) < b;
  if (b == 0.0) {
    return 1.0;
  }
  var resultTemp = select(sign(a) * pow(abs(a), b), pow(abs(a), b),
      round(abs(b) % 2.0) != 1.0);
`,ei=`
  let isModRound1Bool = vec4<i32>(round(abs(b) % vec4<f32>(2.0))) == vec4<i32>(1);
  let isModRound1 = vec4<f32>(isModRound1Bool);
  let multiplier = sign(a) * isModRound1 + (vec4<f32>(1.0) - isModRound1);
  var resultTemp = multiplier * pow(abs(a), b);

  // Ensure that a^0 = 1, including 0^0 = 1 as this correspond to TF and JS
  let isExpZero = b == vec4<f32>(0.0);
  if (isExpZero.r) {
    resultTemp.r = 1.0;
  }
  if (isExpZero.g) {
    resultTemp.g = 1.0;
  }
  if (isExpZero.b) {
    resultTemp.b = 1.0;
  }
  if (isExpZero.a) {
    resultTemp.a = 1.0;
  }
  let isNaN = (a < vec4<f32>(0.0)) & (floor(b) < b);
`,er=`
  let aLessThanZero = vec4<f32>(a < vec4<f32>(0.0));
  return (aLessThanZero * (b * a)) + ((vec4<f32>(1.0) - aLessThanZero) * a);
`;function ea(e,t){let i;do{let r,a,s;switch(e){case o.ATAN2:i="let resultTemp = atan2(a, b);";break;case o.MAX:i="let resultTemp = max(a, b);";break;case o.MIN:i="let resultTemp = min(a, b);";break;case o.MOD:i=t?Z:Q;break;case o.NOT_EQUAL:i=t?ee:J;break;case o.POW:i=t?ei:et;break;default:continue}return t?(r="isnanVec4",a="vec4<f32>",s="vec4<bool>"):(r="isnan",a="f32",s="bool"),`
      let aIsNaN = ${r}(a);
      let aPostLegalization = select(a, ${a}(42), aIsNaN);
      let bIsNaN = ${r}(b);
      let bPostLegalization = select(b, ${a}(42), bIsNaN);
      let isNaN = false;
      let valueForNaN = uniforms.NAN;
      {
        let a = aPostLegalization;
        let b = bPostLegalization;
        ${i}
        return select(
            resultTemp, ${a}(valueForNaN),
            ${s}(isNaN) | aIsNaN | bIsNaN);
      }
    `}while(!1);switch(e){case o.ADD:i="let resultTemp = a + b;";break;case o.COMPLEX_MULTIPLY_IMAG:i="let resultTemp = areal * bimag + aimag * breal;";break;case o.COMPLEX_MULTIPLY_REAL:i="let resultTemp = areal * breal - aimag * bimag;";break;case o.DIV:i="let resultTemp = a / b;";break;case o.ELU_DER:i="let resultTemp = select(a * (b + 1.0), a, b >= b - b);";break;case o.EQUAL:i=M;break;case o.FLOOR_DIV:i=G;break;case o.GREATER:i=H;break;case o.GREATER_EQUAL:i=X;break;case o.LESS:i=K;break;case o.LESS_EQUAL:i=q;break;case o.LOGICAL_AND:return t?Y:"return f32(a >= 1.0 && b >= 1.0);";case o.LOGICAL_OR:return t?j:"return f32(a >= 1.0 || b >= 1.0);";case o.MUL:i="let resultTemp = a * b;";break;case o.PRELU:return t?er:"if (a < 0.0) { return b * a; }  return a;";case o.SQUARED_DIFFERENCE:i="let resultTemp = (a - b) * (a - b);";break;case o.SUB:i="let resultTemp = a - b;"}return`
    ${i}
    return resultTemp;
  `}!function(e){e[e.ABS=0]="ABS",e[e.ACOS=1]="ACOS",e[e.ACOSH=2]="ACOSH",e[e.ASIN=3]="ASIN",e[e.ASINH=4]="ASINH",e[e.ATAN=5]="ATAN",e[e.ATANH=6]="ATANH",e[e.CEIL=7]="CEIL",e[e.COS=8]="COS",e[e.COSH=9]="COSH",e[e.ELU=10]="ELU",e[e.ERF=11]="ERF",e[e.EXP=12]="EXP",e[e.EXPM1=13]="EXPM1",e[e.FLOOR=14]="FLOOR",e[e.IS_FINITE=15]="IS_FINITE",e[e.IS_INF=16]="IS_INF",e[e.IS_NAN=17]="IS_NAN",e[e.LINEAR=18]="LINEAR",e[e.LOG=19]="LOG",e[e.LOG1P=20]="LOG1P",e[e.LOGICAL_NOT=21]="LOGICAL_NOT",e[e.NEG=22]="NEG",e[e.RELU=23]="RELU",e[e.RELU6=24]="RELU6",e[e.LEAKYRELU=25]="LEAKYRELU",e[e.RECIPROCAL=26]="RECIPROCAL",e[e.ROUND=27]="ROUND",e[e.RSQRT=28]="RSQRT",e[e.SELU=29]="SELU",e[e.SIGMOID=30]="SIGMOID",e[e.SIGN=31]="SIGN",e[e.SIN=32]="SIN",e[e.SINH=33]="SINH",e[e.SOFTPLUS=34]="SOFTPLUS",e[e.SQRT=35]="SQRT",e[e.SQUARE=36]="SQUARE",e[e.STEP=37]="STEP",e[e.TAN=38]="TAN",e[e.TANH=39]="TANH",e[e.TO_INT=40]="TO_INT"}(n||(n={}));let es=`
  if (abs(a) > 1.) {
    return uniforms.NAN;
  }
  return acos(a);
`,eo=`
  if (a < 1.) {
    return uniforms.NAN;
  }
  return acosh(a);
`,en=`
  if (abs(a) > 1.) {
    return uniforms.NAN;
  }
  return asin(a);
`,eu=`
  if (isnan(a)) {
    return uniforms.NAN;
  }
  return atan(a);
`,el=`
  if (abs(a) > 1.) {
    return uniforms.NAN;
  }
  if (a == 1.) {
    return uniforms.INFINITY;
  }
  if (a == -1.) {
    return -uniforms.INFINITY;
  }
  return atanh(a);
`,ed=`
  let e2x = exp(-a);
  return (e2x + 1.0 / e2x) / 2.0;
`,eh=`
  var resFloat = exp(a) - vec4<f32>(1.0);
  if (a.r >= 0.0) {
    resFloat.r = a.r;
  }
  if (a.g >= 0.0) {
    resFloat.g = a.g;
  }
  if (a.b >= 0.0) {
    resFloat.b = a.b;
  }
  if (a.a >= 0.0) {
    resFloat.a = a.a;
  }
  return resFloat;
`,ep=`
  // Error function is calculated approximately with elementary function.
  // See "Handbook of Mathematical Functions with Formulas,
  // Graphs, and Mathematical Tables", Abramowitz and Stegun.
  let p = ${d.backend_util.ERF_P};
  let a1 = ${d.backend_util.ERF_A1};
  let a2 = ${d.backend_util.ERF_A2};
  let a3 = ${d.backend_util.ERF_A3};
  let a4 = ${d.backend_util.ERF_A4};
  let a5 = ${d.backend_util.ERF_A5};

  let sign = sign(a);
  let absA = abs(a);
  let t = 1.0 / (1.0 + p * absA);
  return sign * (1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * exp(-absA * absA));
`,ec=`if (a < 0.0) { return uniforms.NAN; }
  return log(a);`,ef=`
  if (isnan(a)) { return a; }
  return log(1.0 + a);
`,em=`
  let aLessThanZero = vec4<f32>(a < vec4<f32>(0.0));
  return (aLessThanZero * (uniforms.alpha * a)) + ((vec4<f32>(1.0) - aLessThanZero) * a);
`,eg=`
  return select(a, vec4<f32>(0.0), a < vec4<f32>(0.0));
`,ex=`
  if (a >= 0.0) {
    return ${d.backend_util.SELU_SCALE} * a;
  } else {
    return ${d.backend_util.SELU_SCALEALPHA} * (exp(a) - 1.0);
  }
`,ey=`
  let e2x = exp(a);
  return (e2x - 1.0 / e2x) / 2.0;
`,ew=`
  let epsilon = 1.1920928955078125e-7;
  let threshold = log(epsilon) + 2.0;

  let too_large = a > -threshold;
  let too_small = a < threshold;
  let exp_a = exp(a);

  if (too_large) {
    return a;
  } else if (too_small) {
    return exp_a;
  } else {
    return log(exp_a + 1.0);
  }
`,eb=`
  if (isnan(a)) {
    return a;
  }

  return select(uniforms.stepAlpha, 1.0, a > 0.0);
`,eC=`
  let e2x = exp(-2.0 * abs(a));
  return sign(a) * (1.0 - e2x) / (1.0 + e2x);
`;function eS(e,t){switch(e){case n.ABS:return"return abs(a);";case n.ACOS:return es;case n.ACOSH:return eo;case n.ASIN:return en;case n.ASINH:return"return asinh(a);";case n.ATAN:return eu;case n.ATANH:return el;case n.COS:return"return cos(a);";case n.COSH:return ed;case n.CEIL:return"return ceil(a);";case n.ELU:return t?eh:"if (a >= 0.0) { return a; }  return (exp(a) - 1.0);";case n.ERF:return ep;case n.EXP:return"return exp(a);";case n.EXPM1:return"return exp(a) - 1.0;";case n.FLOOR:return"return floor(a);";case n.IS_FINITE:return"return f32(!isnan(a) && !isinf(a));";case n.IS_INF:return"return f32(isinf(a));";case n.IS_NAN:return"return f32(isnan(a));";case n.LINEAR:return"return a;";case n.LOG:return ec;case n.LOG1P:return ef;case n.LOGICAL_NOT:return"return f32(!(a >= 1.0));";case n.NEG:return"return -a;";case n.LEAKYRELU:return t?em:"if (a < 0.0) { return uniforms.alpha * a; } return a;";case n.RECIPROCAL:return"return 1.0 / a;";case n.RELU:return t?eg:"return select(a, 0.0, a < 0.0);";case n.RELU6:return t?"return clamp(a, vec4<f32>(0.0, 0.0, 0.0, 0.0), vec4<f32>(6.0, 6.0, 6.0, 6.0));":"return clamp(a, 0.0, 6.0);";case n.ROUND:return"return round(a);";case n.RSQRT:return"return inverseSqrt(a);";case n.SELU:return ex;case n.SIGMOID:return"return 1.0 / (1.0 + exp(-1.0 * a));";case n.SIGN:return"return sign(a);";case n.SIN:return"return sin(a);";case n.SINH:return ey;case n.SOFTPLUS:return ew;case n.SQRT:return"return sqrt(a);";case n.SQUARE:return"return a * a;";case n.STEP:return eb;case n.TAN:return"return tan(a);";case n.TANH:return eC;case n.TO_INT:return"return f32(i32((a)));";default:throw Error(`BinaryType ${e} is not implemented!`)}}function ev(e,t=!1,i=!1,r=3){if(null===e)return"";let a="";if("linear"===e)a=eS(n.LINEAR);else if("relu"===e)a=eS(n.RELU,i);else if("elu"===e)a=eS(n.ELU,i);else if("relu6"===e)a=eS(n.RELU6,i);else if("prelu"===e)a=ea(o.PRELU,i);else if("sigmoid"===e)a=eS(n.SIGMOID,i);else if("leakyrelu"===e)a=eS(n.LEAKYRELU,i);else throw Error(`Activation ${e} has not been implemented for the WebGPU backend.`);let s=w(i?4:1);return t?`
      fn activation(a : ${s}, coords : vec${r}<i32>) -> ${s} {
        let b = getPreluActivationWeightsByOutputCoords(coords);
        ${a}
      }`:`
      fn activation(a : ${s}, coords : vec${r}<i32>) -> ${s} {
        ${a}
      }`}function eI(e,t){return`
      ${e?"value = value + getBiasByOutputCoords(coords);":""}
      ${t?"value = activation(value, coords);":""}
      `}function ek(e,t,i=!1,r=!1,a=!1,s=1){d.util.assert(e&&1===s||!e,()=>`transposeA ${e} is not compatible with component size ${s}`);let o=`
      ${e?"value = getA(batch, col, row);":"value = getA(batch, row, col);"}

    `;return`
  fn mm_readA(batch: i32, row: i32, col: i32) -> ${w(s)} {
    var value = ${w(s)}(0.0);
    ${i&&a?o:`
    ${e?"if(row < uniforms.dimAOuter && col < uniforms.dimInner)":"if(row < uniforms.aShape[1] && col < uniforms.aShape[2])"}
    {
      ${o}
    }
    `}
    return value;
  }

  fn mm_readB(batch: i32, row: i32, col: i32) -> ${w(s)} {
    var value = ${w(s)}(0.0);
    ${t?"value = getB(batch, col, row);":"value = getB(batch, row, col);"}
    return value;
  }
  `}function eR(e,t,i,r,a=!1,s=!1,o=!1,n=1){return`
  ${ek(i,r,a,s,o,n)}
  fn mm_write(batch: i32, row: i32, col: i32, valueIn: ${w(n)}) {
    ${a&&s?"":"if (row < uniforms.dimAOuter && col < uniforms.dimBOuter)"}
    {
      var value = valueIn;
      let coords = vec3<i32>(batch, row, col);
      ${eI(e,t)}
      setOutputAtCoords(coords[0], coords[1], coords[2], value);
    }
  }
  `}let e$=(e,t)=>e?`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          kStart + inputRow,
          globalRowStart + inputCol * ${t});
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          globalRow + innerRow,
          kStart + inputCol * ${t});
        `,eP=(e,t,i,r)=>{if(e)return`
      for (var k = 0; k < ${r}; k++) {
        let BCached0 = mm_Bsub[k][tileCol];
        let ACached0 = mm_Asub[k][localRow];
        for (var i = 0; i < ${i}; i++) {
          acc[i] = fma(BCached0, vec4<f32>(ACached0[i]), acc[i]);
        }
      }`;{let e="",a="";for(let i=0;i<t;i++)e+=`let BCached${i} = mm_Bsub[k * ${t} + ${i}][tileCol];`,a+=`acc[i] = fma(BCached${i}, vec4<f32>(ACached[${i}]), acc[i]);`;return`
      for (var k = 0; k < ${r/t}; k++) {
        ${e}
        for (var i = 0; i < ${i}; i++) {
          let ACached = mm_Asub[tileRow + i][k];
          ${a}
        }
      }`}};function ez(e,t,i=!1,r=32,a=!1,s=32,o=!1){let n=t[1]*e[1],u=t[0]*e[0],l=i?n:r,h=i?r:n,p=l/t[0],c=r/t[1],f=e[1],m=e[0];return d.util.assert((i&&4===p&&4===e[1]||!i&&(3===p||4===p))&&l%t[0]==0&&r%t[1]==0&&4===e[0],()=>`If transposeA ${i} is true, innerElementSize ${p} and workPerThread[1] ${e[1]} must be 4.
          Otherwise, innerElementSize ${p} must be 3 or 4.
      tileAWidth ${l} must be divisible by workgroupSize[0]${t[0]}. tileInner ${r} must be divisible by workgroupSize[1] ${t[1]}. colPerThread ${e[0]} must be 4.`),`
  var<workgroup> mm_Asub : array<array<vec${p}<f32>, ${l/p}>, ${h}>;
  var<workgroup> mm_Bsub : array<array<vec4<f32>, ${u/e[0]}>, ${r}>;

  ${S()} {
    let localRow = i32(localId.y);
    let tileRow = localRow * ${f};
    let tileCol = i32(localId.x);

    let globalRow = i32(globalId.y) * ${f};
    let globalCol = i32(globalId.x) * ${m};
    let batch = ${a?"0":"i32(globalId.z)"};
    let batchA = ${a||!o?"batch":"batch % uniforms.aShape[0]"};
    let batchB = ${a||!o?"batch":"batch % uniforms.bShape[0]"};
    let globalRowStart = i32(workgroupId.y) * ${n};

    let numTiles = ${a?`${Math.ceil(s/r)}`:`(uniforms.dimInner - 1) / ${r} + 1`};
    var kStart = ${a?`i32(globalId.z) * ${s}`:"0"};

    var acc: array<vec4<f32>, ${f}>;

    // Loop over shared dimension.
    let tileRowB = localRow * ${c};
    for (var t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        for (var innerRow = 0; innerRow < ${f}; innerRow++) {
            let inputRow = tileRow + innerRow;
            let inputCol = tileCol;
            ${e$(i,p)}
        }

        // Load one tile of B into local memory.
        for (var innerRow = 0; innerRow < ${c}; innerRow++) {
            let inputRow = tileRowB + innerRow;
            let inputCol = tileCol;
            mm_Bsub[inputRow][inputCol] = mm_readB(batchB, kStart + inputRow, globalCol);
        }
        kStart = kStart + ${r};
        workgroupBarrier();

        // Compute acc values for a single thread.
        ${eP(i,p,f,r)}
        workgroupBarrier();
    }

    for (var innerRow = 0; innerRow < ${f}; innerRow++) {
        mm_write(batch, globalRow + innerRow, globalCol, acc[innerRow]);
    }
  }`}let eN=e=>e?`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          kStart + inputRow,
          globalRowStart + inputCol);
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batchA,
          globalRowStart + inputRow,
          kStart + inputCol);
        `,eA=e=>e?"let ACached = mm_Asub[k][tileRow + innerRow];":"let ACached = mm_Asub[tileRow + innerRow][k];";function eD(e,t,i=!1,r=32,a=!1,s=32,o=!1,n=!1){let u=e[1]*t[1],l=e[0]*t[0],h=i?u:r,p=i?r:u;d.util.assert(p%t[1]==0&&h%t[0]==0&&r%t[1]==0,()=>`tileAHight ${p} must be divisible by workgroupSize[1]${t[1]}, tileAWidth ${h} must be divisible by workgroupSize[0]${t[0]}, tileInner ${r} must be divisible by workgroupSize[1]${t[1]}`);let c=p/t[1],f=h/t[0],m=r/t[1],g=e[1],x=e[0],y=o?`
      let localRow = i32(localId.y);
      let localCol = i32(localId.x);
      let globalRowStart = i32(workgroupId.y) * ${u};
      let globalColStart = i32(workgroupId.x) * ${l};

      // Loop over shared dimension.
      for (var t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        for (var inputRow = localRow; inputRow < ${p}; inputRow = inputRow + ${t[1]}) {
          for (var inputCol = localCol; inputCol < ${h}; inputCol = inputCol + ${t[0]}) {
            ${eN(i)}
          }
        }
        // Load one tile of B into local memory.
        for (var inputRow = localRow; inputRow < ${r}; inputRow = inputRow + ${t[1]}) {
              for (var inputCol = localCol; inputCol < ${l}; inputCol = inputCol + ${t[0]}) {
            mm_Bsub[inputRow][inputCol] = mm_readB(batchB,
              kStart + inputRow,
              globalColStart + inputCol);
          }
        }
        kStart = kStart + ${r};
        workgroupBarrier();

        // Compute acc values for a single thread.
        var BCached : array<f32, ${x}>;
        for (var k = 0; k < ${r}; k++) {
          for (var inner = 0; inner < ${x}; inner++) {
            BCached[inner] = mm_Bsub[k][localCol + inner * ${t[0]}];
          }
          for (var innerRow = 0; innerRow < ${g}; innerRow++) {
            let ACached = ${i?`mm_Asub[k][localRow + innerRow * ${t[1]}];`:`mm_Asub[localRow + innerRow * ${t[1]}][k];`}
            for (var innerCol = 0; innerCol < ${x}; innerCol++) {
              acc[innerRow][innerCol] =
                  fma(ACached, BCached[innerCol], acc[innerRow][innerCol]);
            }
          }
        }
        workgroupBarrier();
      }
      for (var innerRow = 0; innerRow < ${g}; innerRow++) {
        let gRow = globalRowStart + localRow + innerRow * ${t[1]};
        for (var innerCol = 0; innerCol < ${x}; innerCol++) {
          let gCol = globalColStart + localCol + innerCol * ${t[0]};
          mm_write(batch, gRow, gCol, acc[innerRow][innerCol]);
        }
      }
      `:`
  let tileRow = i32(localId.y) * ${g};
  let tileCol = i32(localId.x) * ${x};

  let globalRow = i32(globalId.y) * ${g};
  let globalCol = i32(globalId.x) * ${x};
  let globalRowStart = i32(workgroupId.y) * ${u};

  let tileRowA = i32(localId.y) * ${c};
  let tileColA = i32(localId.x) * ${f};
  let tileRowB = i32(localId.y) * ${m};
  // Loop over shared dimension.
  for (var t = 0; t < numTiles; t++) {
    // Load one tile of A into local memory.
    for (var innerRow = 0; innerRow < ${c}; innerRow++) {
      for (var innerCol = 0; innerCol < ${f}; innerCol++) {
        let inputRow = tileRowA + innerRow;
        let inputCol = tileColA + innerCol;
        ${eN(i)}
      }
    }

    // Load one tile of B into local memory.
    for (var innerRow = 0; innerRow < ${m}; innerRow++) {
      for (var innerCol = 0; innerCol < ${x}; innerCol++) {
        let inputRow = tileRowB + innerRow;
        let inputCol = tileCol + innerCol;
        mm_Bsub[inputRow][inputCol] = mm_readB(batchB,
          kStart + inputRow,
          globalCol + innerCol);
      }
    }
    kStart = kStart + ${r};
    workgroupBarrier();

    // Compute acc values for a single thread.
    var BCached : array<f32, ${x}>;
    for (var k = 0; k < ${r}; k++) {
      for (var inner = 0; inner < ${x}; inner++) {
        BCached[inner] = mm_Bsub[k][tileCol + inner];
      }

      for (var innerRow = 0; innerRow < ${g}; innerRow++) {
        ${eA(i)}
        for (var innerCol = 0; innerCol < ${x}; innerCol++) {
          acc[innerRow][innerCol] =
              fma(ACached, BCached[innerCol], acc[innerRow][innerCol]);
        }
      }
    }

    workgroupBarrier();
  }

  for (var innerRow = 0; innerRow < ${g}; innerRow++) {
    for (var innerCol = 0; innerCol < ${x}; innerCol++) {
      mm_write(batch, globalRow + innerRow, globalCol + innerCol,
          acc[innerRow][innerCol]);
    }
  }
  `;return`
    var<workgroup> mm_Asub : array<array<f32, ${h}>, ${p}>;
    var<workgroup> mm_Bsub : array<array<f32, ${l}>, ${r}>;

    ${S()} {
      let batch = ${a?"0":"i32(globalId.z)"};
      let batchA = ${a||!n?"batch":"batch % uniforms.aShape[0]"};
      let batchB = ${a||!n?"batch":"batch % uniforms.bShape[0]"};
      let numTiles = ${a?`${Math.ceil(s/r)}`:`(uniforms.dimInner - 1) / ${r} + 1`};
      var kStart = ${a?`i32(globalId.z) * ${s}`:"0"};

      var acc : array<array<f32, ${x}>, ${g}>;

      // Without this initialization strange values show up in acc.
      for (var innerRow = 0; innerRow < ${g}; innerRow++) {
        for (var innerCol = 0; innerCol < ${x}; innerCol++) {
          acc[innerRow][innerCol] = 0.0;
        }
      }
      ${y}
    }
  `}let eF=e=>e?`
      mm_readA(batchA, colA, globalRow),
      mm_readA(batchA, colA + 1, globalRow),
      mm_readA(batchA, colA + 2, globalRow),
      mm_readA(batchA, colA + 3, globalRow)
  `:`
      mm_readA(batchA, globalRow, colA),
      mm_readA(batchA, globalRow, colA + 1),
      mm_readA(batchA, globalRow, colA + 2),
      mm_readA(batchA, globalRow, colA + 3)
  `;class e_{constructor(e,t,i=!1,r=!1,a=null,s=null,o=null,n=!1){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.outputShape=t,this.dispatchLayout={x:[2],y:[1],z:[0]};let u=i?e[1]:e[2];if(this.isVec4=(u%4==0&&!i||t[1]%4==0&&i)&&t[2]%4==0&&!r,this.outputComponent=this.isVec4?4:1,this.isVectorA=1===t[1]&&!i,!this.isVec4&&this.isVectorA)this.elementsPerThread=[1,1,1],this.workgroupSize=[32,1,1];else{let e=F(t[1],u,t[2],i);this.workgroupSize=e.workgroupSize,this.elementsPerThread=e.elementsPerThread}this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,this.elementsPerThread);let l=null!=a,d=null!=o;l&&this.variableNames.push("bias"),d&&this.variableNames.push("preluActivationWeights"),this.sequentialAccessByThreads=n,this.transposeA=i,this.transposeB=r,this.addBias=l,this.activation=s,this.hasPreluActivationWeights=d,[this.fitAOuter,this.fitBOuter,this.fitInner]=this.getShapeFit(t[1],t[2],u),this.shaderKey=`matMulPacked_${this.elementsPerThread}_${i}_${r}_${this.activation}_${this.fitAOuter}_${this.fitBOuter}_${this.fitInner}_${this.isVec4}_${this.isVectorA}_${this.sequentialAccessByThreads}`}getShapeFit(e,t,i){let r=this.workgroupSize[1]*this.elementsPerThread[1],a=this.workgroupSize[0]*this.elementsPerThread[0];return!this.isVec4&&this.isVectorA?this.tileInner=4*this.workgroupSize[0]:this.tileInner=a,[e%r==0,t%a==0,i%this.tileInner==0]}getUserCode(){return`
      ${ev(this.activation,this.hasPreluActivationWeights,this.isVec4)}
      ${eR(this.addBias,this.activation,!1,this.transposeB,this.fitAOuter,this.fitBOuter,this.fitInner,this.isVec4?4:1)}
      ${this.isVec4?ez(this.elementsPerThread,this.workgroupSize,this.transposeA,this.tileInner,!1,null,!0):this.isVectorA?function(e,t=!1){d.util.assert(1===e[1]&&1===e[2],()=>`A linear work group size is required. But got ${e}.`);let i=4*e[0];return`
    var<workgroup> mm_Asub : array<vec4<f32>, ${e[0]}>;

    ${S()} {
      let tileCol = i32(localId.x);
      let globalCol = i32(globalId.x);
      let globalRow = i32(globalId.y);

      let numTiles = (uniforms.dimInner - 1) / ${i} + 1;
      let batch = i32(globalId.z);
      let batchA = batch % uniforms.aShape[0];
      let batchB = batch % uniforms.bShape[0];
      // Without this initialization strange values show up in acc.
      var acc = 0.0;

      // Loop over shared dimension.
      for (var t = 0; t < numTiles; t++) {
        // Load one tile of A into local memory.
        let colA = t * ${i} + tileCol * 4;
        mm_Asub[tileCol] = vec4<f32>(${eF(t)});
        workgroupBarrier();

        // Compute acc values for a single thread.
        for (var k = 0; k < ${i/4}; k++) {
          let rowB = t * ${i} + k * 4;
          let BCached = vec4<f32>(mm_readB(batchB, rowB, globalCol),
                              mm_readB(batchB, rowB + 1, globalCol),
                              mm_readB(batchB, rowB + 2, globalCol),
                              mm_readB(batchB, rowB + 3, globalCol));

          let ACached = mm_Asub[k];
          acc = acc + dot(ACached, BCached);
        }

        workgroupBarrier();
      }

      mm_write(batch, globalRow, globalCol, acc);
    }
  `}(this.workgroupSize,this.transposeA):eD(this.elementsPerThread,this.workgroupSize,this.transposeA,this.tileInner,!1,null,this.sequentialAccessByThreads,!0)}
    `}}class eT{constructor(e,t=!1,i=!1,r=null,a=null,s=null){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.workgroupSize=[256,1,1],this.outputShape=e,this.dispatchLayout={x:[],y:[1,2],z:[0]},this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize);let o=null!=r,n=null!=s;o&&this.variableNames.push("bias"),n&&this.variableNames.push("preluActivationWeights"),this.transposeA=t,this.transposeB=i,this.addBias=o,this.activation=a,this.hasPreluActivationWeights=n,this.shaderKey=`matMulReduce_${this.activation}_${t}_${i}`}getUserCode(){var e;return`
      ${ev(this.activation,this.hasPreluActivationWeights)}
      ${eR(this.addBias,this.activation,this.transposeA,this.transposeB)}
      ${e=this.workgroupSize[0],`
    var<workgroup> sumValues : array<f32, ${e}>;
    ${S()} {
      let coords = getOutputCoords();
      let batch = coords[0];
      let batchA = batch % uniforms.aShape[0];
      let batchB = batch % uniforms.bShape[0];
      let row = coords[1];
      let col = coords[2];
      var sum = 0.0;
      let Length = uniforms.dimInner;
      for (var k = i32(localId.x); k < Length; k = k + ${e}) {
        let dataA = mm_readA(batchA, row, k);
        let dataB = mm_readB(batchB, k, col);
        sum = sum + dataA * dataB;
      }
      sumValues[localId.x] = sum;
      workgroupBarrier();

      for(var currentSize = ${e/2}u; currentSize > 1u;
          currentSize = currentSize / 2u) {
        if (localId.x < currentSize)
        {
          sumValues[localId.x] = sumValues[localId.x] + sumValues[localId.x + currentSize];
        }
        workgroupBarrier();
      }

      if (localId.x == 0u) {
        sum = sumValues[0] + sumValues[1];
        mm_write(batch, row, col, sum);
      }
    }
  `}
    `}}class eL{constructor(e,t,i,r=!1,a=!1,s=null,o=null,n=null){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.workgroupSize=[16,8,1],this.outputShape=i,this.dispatchLayout={x:[2],y:[1],z:[0]},this.dispatch=[Math.ceil(i[2]/this.workgroupSize[0]),Math.ceil(i[1]/this.workgroupSize[1]),i[0]];let u=null!=s;u&&this.variableNames.push("bias");let l=null!=n;l&&this.variableNames.push("preluActivationWeights"),this.transposeA=r,this.transposeB=a,this.addBias=u,this.activation=o,this.hasPreluActivationWeights=l,this.shaderKey=`matMulSmallOutputSize_${this.activation}_${r}_${a}`}getUserCode(){return`
      ${ev(this.activation,this.hasPreluActivationWeights)}
      ${eR(this.addBias,this.activation,this.transposeA,this.transposeB)}
      ${function(e){let t=e[1],i=e[0],r=t>i?t:i;return`
  var<workgroup> mm_Asub : array<array<f32, ${r}>, ${t}>;
  var<workgroup> mm_Bsub : array<array<f32, ${i}>, ${r}>;

  // If the output size is small for matrix multiplication, avoid to use vec4
  // and handle some elements per thread to optimally utilize the ALU.
  // Read data from global memory to registers firstly, then store them into
  // shared memory, so it is instruction-Level parallelism for arithmetic
  // operations and others handle IO operations between barrier api, makes ALU
  // and load/store units work simultaneously, could improves the performance.
  ${S()} {
    let tileRow = i32(localId.y);
    let tileCol = i32(localId.x);
    let globalRow = i32(globalId.y);
    let globalCol = i32(globalId.x);
    let batch = i32(globalId.z);
    let batchA = batch % uniforms.aShape[0];
    let batchB = batch % uniforms.bShape[0];

    // uniforms.dimInner should be greater than 0.
    let numTiles = (uniforms.dimInner - 1) / ${r} + 1;
    var acc = 0.0;

    var globalColA = tileCol;
    var globalRowB = 0;
    var regA = mm_readA(batchA, globalRow, globalColA);
    var regB0 = mm_readB(batchB, globalRowB + 2 * tileRow, globalCol);
    var regB1 = mm_readB(batchB, globalRowB + 2 * tileRow + 1, globalCol);
    globalColA = globalColA + ${r};
    globalRowB = globalRowB + ${r};

    for (var t = 0; t < numTiles; t = t + 1) {
      mm_Asub[tileRow][tileCol] = regA;
      mm_Bsub[2 * tileRow][tileCol] = regB0;
      mm_Bsub[2 * tileRow + 1][tileCol] = regB1;

      workgroupBarrier();

      regA = mm_readA(batchA, globalRow, globalColA);
      regB0 = mm_readB(batchB, globalRowB + 2 * tileRow, globalCol);
      regB1 = mm_readB(batchB, globalRowB + 2 * tileRow + 1, globalCol);
      globalColA = globalColA + ${r};
      globalRowB = globalRowB + ${r};

      for (var k = 0; k < ${r}; k = k + 1) {
        acc = acc + mm_Asub[tileRow][k] * mm_Bsub[k][tileCol];
      }
      workgroupBarrier();
    }

    mm_write(batch, globalRow, globalCol, acc);
  }
  `}(this.workgroupSize)}
    `}}class eE{constructor(e,t,i=!1,r=!1){this.variableNames=["A","B"],this.uniforms="dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.workgroupSize=[8,8,1],this.atomic=!0,this.splitedDimInner=128,d.util.assert(1===e[0],()=>"MatMulSplitKProgram only supports batch = 1."),this.outputShape=e,this.dispatchLayout={x:[2],y:[1],z:[0,3]};let a=(i&&this.outputShape[1]%4==0||!i&&t%4==0)&&this.outputShape[2]%4==0;this.elementsPerThread=[4,4,this.splitedDimInner],this.outputComponent=a?4:1,!a&&(this.outputShape[1]<16&&(this.elementsPerThread[1]=1),this.outputShape[2]<16&&(this.elementsPerThread[0]=1)),this.dispatch=D(this.dispatchLayout,[this.outputShape[0],this.outputShape[1],this.outputShape[2],t],this.workgroupSize,this.elementsPerThread),this.transposeA=i,this.transposeB=r,this.shaderKey=`matMulSplitK_${i}_${r}_${this.elementsPerThread}_${this.outputComponent}`}getUserCode(){let e=this.outputComponent;return`
      ${ek(!1,this.transposeB,!1,!1,!1,e)}
      fn mm_write(batch: i32, row : i32, col : i32, value : ${w(e)}) {
        if (row < uniforms.dimAOuter && col < uniforms.dimBOuter) {
          let coords = vec3<i32>(batch, row, col);
          let flatIndex = getOutputIndexFromCoords(coords);
          // The problem is that we should initialize output to zero before using.
          // Otherwise, the original value will be added to the result.
          for (var i = 0; i < ${e}; i = i + 1) {
            ${x("&result[flatIndex + i]",`${e>1?"value[i]":"value"}`,"float32")}
          }
        }
      }
      ${4===e?ez(this.elementsPerThread,this.workgroupSize,this.transposeA,32,!0,this.splitedDimInner):eD(this.elementsPerThread,this.workgroupSize,this.transposeA,32,!0,this.splitedDimInner)}
    `}}class eB{constructor(e,t=null,i=null,r=null){this.uniforms="",this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.addBias=null!=t,this.hasPreluActivationWeights=null!=r,this.activation=i,this.addBias&&this.variableNames.push("bias"),this.hasPreluActivationWeights&&this.variableNames.push("preluActivationWeights"),this.shaderKey=`biasActivation_${i}`}getUserCode(){return`
    ${ev(this.activation,this.hasPreluActivationWeights)}
    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        var value = getXByOutputIndex(index);
        ${eI(this.addBias,this.activation)}
        setOutputAtIndex(index, value);
      }
    }
    `}}class eW{constructor(e){this.variableNames=[],this.outputShape=[],this.uniforms="value : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="fill"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.size) {
        setOutputAtIndex(index, uniforms.value);
      }
    }
  `}}function eO(e){let{backend:t,attrs:i}=e,{shape:r,value:a}=i,{dtype:s}=i;if("string"===(s=s||d.util.inferDtype(a))){let e=d.util.getArrayFromDType(s,d.util.sizeFromShape(r));return e.fill(a),t.makeTensorInfo(r,s,e)}{let e=new eW(r);return t.runWebGPUProgram(e,[],s,[{type:"float32",data:[a]}])}}let eU={kernelName:d.Fill,backendName:"webgpu",kernelFunc:eO};function eV(e){let{inputs:t,attrs:i}=e,{x:r}=t,{shape:a}=i,s=d.util.sizeFromShape(r.shape),o=d.util.inferFromImplicitShape(a,s),n=d.util.sizeFromShape(o);return d.util.assert(s===n,()=>`The new shape (${o}) has ${n} elements and the old shape (${r.shape}) has ${s} elements. The new shape and old shape must have the same number of elements.`),e.backend.incRef(r.dataId),{dataId:r.dataId,shape:o,dtype:r.dtype}}let eM={kernelName:d.Reshape,backendName:"webgpu",kernelFunc:eV};function eG({a:e,b:t,transposeA:i,transposeB:r,backend:a,bias:o=null,preluActivationWeights:n=null,leakyreluAlpha:u=0,activation:l=null}){let h,p;let c=e.shape.length,f=t.shape.length,m=i?e.shape[c-2]:e.shape[c-1],g=r?t.shape[f-1]:t.shape[f-2],x=i?e.shape[c-1]:e.shape[c-2],y=r?t.shape[f-2]:t.shape[f-1],w=e.shape.slice(0,-2),b=t.shape.slice(0,-2),C=d.util.sizeFromShape(w),S=d.util.sizeFromShape(b),v=d.broadcast_util.assertAndGetBroadcastShape(e.shape.slice(0,-2),t.shape.slice(0,-2)).concat([x,y]);d.util.assert(m===g,()=>`Error in matMul: inner shapes (${m}) and (${g}) of Tensors with shapes ${e.shape} and ${t.shape} and transposeA=${i} and transposeB=${r} must match.`);let I=i?[C,m,x]:[C,x,m],k=r?[S,y,g]:[S,g,y],R=eV({inputs:{x:e},backend:a,attrs:{shape:I}}),$=eV({inputs:{x:t},backend:a,attrs:{shape:k}}),P=[R,$],z=Math.max(C,S),N=[R,$],A=[{type:"int32",data:[x]},{type:"int32",data:[y]},{type:"int32",data:[m]}],D=[z,x,y],F=(0,d.env)().get("WEBGPU_MATMUL_PROGRAM_TYPE");if(F<0){let e=(0,d.env)().getNumber("WEBGPU_THRESHOLD_TO_INCREASE_WORKGROUPS_FOR_MATMUL"),t=e>0?e:a.thresholdToIncreaseWorkgroups,i=z*Math.ceil(x/32)*Math.ceil(y/32);F=i<=t||x<=8&&i<=2*t?z*x*y<=128?s.MatMulReduceProgram:1===z&&g>=2e3?s.MatMulSplitKProgram:s.MatMulSmallOutputSizeProgram:s.MatMulPackedProgram}switch(F){case s.MatMulReduceProgram:h=new eT(D,i,r,o,l,n);break;case s.MatMulSplitKProgram:if(p=eO({backend:a,attrs:{shape:D,value:0,dtype:e.dtype}}),h=new eE(D,g,i,r),o||l){let t=new eB((p=a.runWebGPUProgram(h,N,e.dtype,A,p)).shape,o,l,n),i=null,r=[p];o&&r.push(o),n&&r.push(n),"leakyrelu"===l&&(i=[{type:"float32",data:[u]}],t.uniforms+=" alpha : f32,");let s=a.runWebGPUProgram(t,r,p.dtype,i);P.push(p);let d=eV({inputs:{x:s},backend:a,attrs:{shape:v}});for(let e of(P.push(s),P))a.disposeData(e.dataId);return d}break;case s.MatMulSmallOutputSizeProgram:h=new eL(I,k,D,i,r,o,l,n);break;case s.MatMulPackedProgram:h=new e_(I,D,i,r,o,l,n,a.adapterInfo.isIntel());break;default:throw Error(`Unsupported MatMulProgramType ${F}.`)}o&&N.push(o),n&&N.push(n),"leakyrelu"===l&&(A.push({type:"float32",data:[u]}),h.uniforms+=" alpha : f32,");let _=eV({inputs:{x:p=a.runWebGPUProgram(h,N,e.dtype,A,p)},backend:a,attrs:{shape:v}});for(let e of(P.push(p),P))a.disposeData(e.dataId);return _}let eH={kernelName:d._FusedMatMul,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{a,b:s,bias:o,preluActivationWeights:n}=t,{transposeA:u,transposeB:l,activation:d,leakyreluAlpha:h}=r;return eG({a,b:s,transposeA:u,transposeB:l,backend:i,bias:o,preluActivationWeights:n,leakyreluAlpha:h,activation:d})}};class eX{constructor(e,t,i){this.variableNames=["AReal","AImag","BReal","BImag"],this.workgroupSize=[128,1,1],this.size=!0,this.outputShape=d.backend_util.assertAndGetBroadcastShape(t,i),this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey=`binaryOpComplex_${e}`,this.op=e}getUserCode(){let e=ea(this.op,!1);return`
      fn binaryOpComplex(
          areal : f32, aimag : f32, breal : f32, bimag : f32) -> f32 {
        ${e}
      }

      ${S("index")} {
        if(index < uniforms.size) {
          let areal = getARealByOutputIndex(index);
          let aimag = getAImagByOutputIndex(index);
          let breal = getBRealByOutputIndex(index);
          let bimag = getBImagByOutputIndex(index);
          setOutputAtIndex(index, binaryOpComplex(areal, aimag, breal, bimag));
        }
      }
    `}}class eK{constructor(e,t,i){if(this.size=!0,this.variableNames=["A","B"],this.outputShape=d.backend_util.assertAndGetBroadcastShape(t,i),this.dispatchLayout=L(this.outputShape),this.op=e,this.useSharedMemoryWithA=t.length<=1&&i.length>1&&t[0]<128,this.useSharedMemoryWithB=i.length<=1&&t.length>1&&i[0]<128,this.useSharedMemoryWithA||this.useSharedMemoryWithB)this.outputComponent=1,this.variableComponents=[1,1],this.lastDimensionSize=this.useSharedMemoryWithB?i[0]:t[0],this.shaderKey=`binary_${e}_${this.lastDimensionSize}`,this.type="shared",this.workgroupSize=[256,1,1];else{let r=t.length>0&&t[t.length-1]%4==0,a=i.length>0&&i[i.length-1]%4==0;r&&a?(this.outputComponent=4,this.variableComponents=[4,4]):r&&(d.util.isScalarShape(i)||1===i[i.length-1])||a&&(d.util.isScalarShape(t)||1===t[t.length-1])?(this.outputComponent=4,this.variableComponents=r?[4,1]:[1,4]):(this.outputComponent=1,this.variableComponents=[1,1]),this.type="nonshared",this.shaderKey=`binary_${e}_${this.variableComponents}`,this.workgroupSize=[128,1,1]}this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.outputComponent,1,1])}getUserCode(){let e;let t=4===this.outputComponent?"vec4<f32>":"f32",i=`
    fn binaryOperation(a : ${t}, b : ${t}) -> ${t} {
      ${ea(this.op,4===this.outputComponent)}
    };
    `;if("shared"===this.type){let t=this.lastDimensionSize>1?`coords[${this.outputShape.length-1}]`:"0",r=this.useSharedMemoryWithB?`let a = getAByOutputIndex(index);
          let b = sharedBuf[${t}];`:`let a = sharedBuf[${t}];
          let b = getBByOutputIndex(index);`;e=`
        ${i}
        var<workgroup> sharedBuf : array<f32, ${this.lastDimensionSize}>;
        ${S("index")} {
          // Fill in the shared memory buffer.
          let localIndex = i32(localId.x);
          if(localIndex < ${this.lastDimensionSize}) {
            sharedBuf[localIndex] = f32(${this.useSharedMemoryWithB?"B":"A"}[localIndex]);
          }
          workgroupBarrier();

          if(index < uniforms.size) {
            let coords = getCoordsFromIndex(index);
            ${r}
            setOutputAtIndex(index, binaryOperation(a, b));
          }
        }
        `}else e=`
       ${i}
       ${S("index")} {
         if (index < uniforms.size) {
           let coords = getCoordsFromIndex(index * ${this.outputComponent});
           let a = ${t}(getAByOutputCoords(coords));
           let b = ${t}(getBByOutputCoords(coords));
           setOutputAtIndex(index, binaryOperation(a, b));
         }
       }
       `;return e}}function eq(e){let{inputs:t}=e,{x:i}=t;return e.backend.incRef(i.dataId),{dataId:i.dataId,shape:i.shape,dtype:i.dtype}}let eY={kernelName:d.Identity,backendName:"webgpu",kernelFunc:eq};function ej(e){let{inputs:t,backend:i}=e,{real:r,imag:a}=t,s=i.makeTensorInfo(r.shape,"complex64"),o=i.tensorMap.get(s.dataId),n=eq({inputs:{x:r},backend:i}),u=eq({inputs:{x:a},backend:i});return o.complexTensorInfos={real:n,imag:u},s}let eQ={kernelName:d.Complex,backendName:"webgpu",kernelFunc:ej};class eZ{constructor(e,t,i=""){this.variableNames=["A"],this.size=!0,this.workgroupSize=[128,1,1],this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.op=t,""!==i&&(this.uniforms=i),this.shaderKey=`unary_${t}`}getUserCode(){return`
      fn unaryOperation(a : f32) -> f32 {
        ${eS(this.op,!1)}
      }
      ${S("index")} {
        if (index < uniforms.size) {
          let a = getAByOutputIndex(index);
          setOutputAtIndex(index, unaryOperation(a));
        }
      }
      `}}function eJ({opType:e,cpuKernelImpl:t,dtype:i}){return({inputs:r,backend:a})=>{let{x:s}=r,o=i||s.dtype;if(a.shouldExecuteOnCPU([s])&&null!=t){let e=t(a.tensorMap.get(s.dataId).values,o);return a.makeTensorInfo(s.shape,o,e)}let n=new eZ(s.shape,e);return a.runWebGPUProgram(n,[s],o)}}function e2({opType:e,cpuKernelImpl:t,supportsComplex:i=!1,dtype:r}){return({inputs:a,backend:s})=>{let{a:n,b:u}=a;if(i&&"complex64"===n.dtype){let t,i;let r=s.tensorMap.get(n.dataId),a=s.tensorMap.get(u.dataId);if(e!==o.MUL)[t,i]=[[r.complexTensorInfos.real,a.complexTensorInfos.real],[r.complexTensorInfos.imag,a.complexTensorInfos.imag]].map(t=>{let[i,r]=t,a={dataId:i.dataId,dtype:i.dtype,shape:n.shape},o={dataId:r.dataId,dtype:r.dtype,shape:u.shape},l=new eK(e,n.shape,u.shape);return s.runWebGPUProgram(l,[a,o],(0,d.upcastType)(i.dtype,r.dtype))});else{let e=new eX(o.COMPLEX_MULTIPLY_REAL,n.shape,u.shape),l=new eX(o.COMPLEX_MULTIPLY_IMAG,n.shape,u.shape),d=[{dataId:r.complexTensorInfos.real.dataId,dtype:r.complexTensorInfos.real.dtype,shape:n.shape},{dataId:r.complexTensorInfos.imag.dataId,dtype:r.complexTensorInfos.imag.dtype,shape:n.shape},{dataId:a.complexTensorInfos.real.dataId,dtype:a.complexTensorInfos.real.dtype,shape:u.shape},{dataId:a.complexTensorInfos.imag.dataId,dtype:a.complexTensorInfos.imag.dtype,shape:u.shape}];t=s.runWebGPUProgram(e,d,"float32"),i=s.runWebGPUProgram(l,d,"float32")}let l=ej({inputs:{real:t,imag:i},backend:s});return s.disposeData(t.dataId),s.disposeData(i.dataId),l}let l=r||(0,d.upcastType)(n.dtype,u.dtype);if(("string"===n.dtype||"string"===u.dtype||s.shouldExecuteOnCPU([n,u]))&&null!=t){let e=s.tensorMap.get(n.dataId).values,i=s.tensorMap.get(u.dataId).values,r="string"===n.dtype?d.backend_util.fromUint8ToStringArray(e):e,a="string"===n.dtype?d.backend_util.fromUint8ToStringArray(i):i,[o,h]=t(n.shape,u.shape,r,a,l);return s.makeTensorInfo(h,l,o)}let h=new eK(e,n.shape,u.shape);return s.runWebGPUProgram(h,[n,u],l)}}let{addImpl:e3,castImpl:e0,ceilImpl:e1,concatImpl:e4,equalImpl:e6,expImpl:e5,expm1Impl:e8,floorImpl:e9,floorDivImpl:e7,gatherNdImpl:te,gatherV2Impl:tt,greaterEqualImpl:ti,greaterImpl:tr,lessEqualImpl:ta,lessImpl:ts,logImpl:to,maxImpl:tn,maximumImpl:tu,minimumImpl:tl,multiplyImpl:td,negImpl:th,notEqualImpl:tp,prodImpl:tc,rangeImpl:tf,rsqrtImpl:tm,scatterImpl:tg,simpleAbsImpl:tx,sliceImpl:ty,stridedSliceImpl:tw,stringNGramsImpl:tb,subImpl:tC,tileImpl:tS,topKImpl:tv,transposeImpl:tI,uniqueImpl:tk}=i(2610),tR=eJ({opType:n.ABS,cpuKernelImpl:tx}),t$={kernelName:d.Abs,backendName:"webgpu",kernelFunc:tR},tP=eJ({opType:n.ACOS}),tz={kernelName:d.Acos,backendName:"webgpu",kernelFunc:tP},tN=eJ({opType:n.ACOSH}),tA={kernelName:d.Acosh,backendName:"webgpu",kernelFunc:tN},tD=e2({opType:o.ADD,cpuKernelImpl:e3,supportsComplex:!0}),tF={kernelName:d.Add,backendName:"webgpu",kernelFunc:tD};class t_{constructor(e){this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e[0],this.variableNames=e.map((e,t)=>`T${t}`),this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.shaderKey="addN"}getUserCode(){let e=[];this.variableNames.forEach(t=>{e.push(`let v${t} = get${t}ByOutputCoords(coords);`)});let t=this.variableNames.map(e=>`v${e}`).join(" + ");return`
      ${S("index")} {
        for (var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let flatIndex = index * ${this.workPerThread} + i;
          if (flatIndex < uniforms.size) {
            let coords = getCoordsFromIndex(flatIndex);
            ${e.join("\n        ")}
            setOutputAtIndex(flatIndex, ${t});
          }
        }
      }
    `}}let tT={kernelName:d.AddN,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e;if(1===t.length)return eq({inputs:{x:t[0]},backend:i});let r=t.map(e=>e.dtype).reduce((e,t)=>(0,d.upcastType)(e,t)),a=new t_(t.map(e=>e.shape));return i.runWebGPUProgram(a,t,r)}};class tL{constructor(e,t){this.variableNames=["A"],this.workgroupSize=[16,16,1];let i=Array(e.length);for(let r=0;r<i.length;r++)i[r]=e[t[r]];this.outputShape=i,this.dispatchLayout={x:[0],y:[1]},this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[1,1,1]),this.shaderKey="transposeShared"}getUserCode(){d.util.assert(this.workgroupSize[0]===this.workgroupSize[1],()=>`Must be a square tile, current tile shape is ${this.workgroupSize[0]} x ${this.workgroupSize[1]}`);let e=this.workgroupSize[0];return`
      var<workgroup> tile : array<array<f32, ${this.workgroupSize[0]+1}>, ${this.workgroupSize[0]}>;
      ${S()} {
        var x = i32(workgroupId.x) * ${e} + i32(localId.x);
        var y = i32(workgroupId.y) * ${e} + i32(localId.y);
        let width = uniforms.outShape[0];
        let height = uniforms.outShape[1];
        if (x < width && y < height) {
          tile[localId.y][localId.x] = f32(A[y * width + x]);
        }
        workgroupBarrier();

        x = i32(workgroupId.y) * ${e} + i32(localId.x);
        y = i32(workgroupId.x) * ${e} + i32(localId.y);
        if (x < height && y < width) {
          setOutputAtIndex((y * height + x), tile[localId.x]
            [localId.y]);
        }
      }
    `}}class tE{constructor(e,t){this.variableNames=["A"],this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0;let i=Array(e.length);for(let r=0;r<i.length;r++)i[r]=e[t[r]];this.outputShape=i,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.newDim=t,this.shaderKey=`transpose_${t}`}getUserCode(){let e=b(this.outputShape.length),t=tB(this.newDim);return`
      ${S("index")} {
        for(var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let flatIndex = index * ${this.workPerThread} + i;
          if(flatIndex < uniforms.size) {
            let coords = getCoordsFromIndex(flatIndex);
            setOutputAtIndex(flatIndex, A[getIndexFromCoords${this.outputShape.length}D(
              ${e}(${t}), uniforms.aShape)]);
          }
        }
      }
    `}}function tB(e){let t=e.length;if(t>6)throw Error(`Transpose for rank ${t} is not yet supported`);let i=Array(t);for(let t=0;t<e.length;t++)i[e[t]]=`coords.${C(t)}`;return i.join()}function tW(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{perm:s}=r,o=Array(a.shape.length);for(let e=0;e<o.length;e++)o[e]=a.shape[s[e]];if(i.shouldExecuteOnCPU([a])){let e=tI(i.tensorMap.get(a.dataId).values,a.shape,a.dtype,s,o);return i.makeTensorInfo(o,a.dtype,e)}if(2===a.shape.length&&d.util.arraysEqual(s,[1,0])){let e=new tL(a.shape,s);return i.runWebGPUProgram(e,[a],a.dtype)}let n=new tE(a.shape,s);return i.runWebGPUProgram(n,[a],a.dtype)}let tO={kernelName:d.Transpose,backendName:"webgpu",kernelFunc:tW};class tU{constructor(e,t,i){this.variableNames=["x"],this.uniforms="reduceSize : i32,",this.size=!0,this.inputShape=[e.batchSize,e.inSize];let[r]=d.backend_util.computeOutAndReduceShapes(this.inputShape,[1]);this.outputShape=0===r.length?[1]:r,e.inSize>=32768&&i>=512?this.workgroupSize=[512,1,1]:e.inSize>=4096?this.workgroupSize=[256,1,1]:this.workgroupSize=[64,1,1],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,[1,1,1]),this.reduceType=t,this.shaderKey=`reduce_${t}`}getUserCode(){let e="",t="0.0",i=this.workgroupSize[0];"min"===this.reduceType||"max"===this.reduceType?(e=`
         if (isnan(candidate)) {
          bestValue = uniforms.NAN;
         } else if (!isnan(bestValue) && candidate ${"min"===this.reduceType?"<":">"} bestValue)
           {  bestValue = candidate; }`,t="f32(x[offset])"):"sum"===this.reduceType||"mean"===this.reduceType?e=" bestValue = bestValue + candidate; ":"prod"===this.reduceType?(e=" bestValue = bestValue * candidate; ",t="1.0"):"all"===this.reduceType?(e=" bestValue = f32(bestValue >= 1.0 && candidate >= 1.0); ",t="1.0"):"any"===this.reduceType&&(e=" bestValue = f32(bestValue >= 1.0 || candidate >= 1.0); ",t="0.0");let r="mean"===this.reduceType?"setOutputAtIndex(outputIndex, bestValue / f32(uniforms.reduceSize));":"setOutputAtIndex(outputIndex, bestValue);",a=`
         var<workgroup> xBestValues : array<f32, ${i}>;
       `;return`
       fn DIV_CEIL(a : u32, b : u32) -> u32 {
        return ((a - 1u) / b + 1u);
       }

       ${a}
       fn getOffset(outputIndex : i32) -> i32 {
         let outputCoords = getCoordsFromIndex(outputIndex);
         let offset = ${1===this.outputShape.length?"outputCoords":"outputCoords[0]"} * uniforms.reduceSize;
          return offset;
       }
       ${S("index")} {
         let outputIndex = index / ${i};
         let offset = getOffset(outputIndex);
         var bestValue = ${t};
         let Length = uniforms.reduceSize;
         let WorkPerThread = DIV_CEIL(u32(Length), ${i}u);
         for (var k = i32(localId.x); k < Length && outputIndex < uniforms.size;
             k = k + ${i}) {
           let candidate = f32(x[offset + k]);
           ${e}
         }
         xBestValues[localId.x] = bestValue;
         workgroupBarrier();

         var reduceSize = min(u32(Length), ${i}u);
         for (var currentSize = reduceSize / 2u; reduceSize > 1u;
             currentSize = reduceSize / 2u) {
           let interval = DIV_CEIL(reduceSize, 2u);
           if (localId.x < currentSize) {
            let candidate = xBestValues[localId.x + interval];
            ${e}
            xBestValues[localId.x] = bestValue;
           }
           reduceSize = interval;
           workgroupBarrier();
         }

         if (localId.x == 0u && outputIndex < uniforms.size) {
          ${r}
        }
       }
     `}}let tV={mean:"float32",all:"bool",any:"bool"};function tM(e,t,i,r,a){let s;let o=e.shape.length,n=[],u=d.util.parseAxisParam(t,e.shape),l=u,h=d.backend_util.getAxesPermutation(l,o),p=e;null!=h&&(p=tW({inputs:{x:e},attrs:{perm:h},backend:a}),l=d.backend_util.getInnerMostAxes(l.length,o),n.push(p)),d.backend_util.assertAxesAreInnerMostDims(r,l,o);let[c,f]=d.backend_util.computeOutAndReduceShapes(p.shape,l),m=c;if(i&&(m=d.backend_util.expandShapeToKeepDim(c,u)),("max"===r||"prod"===r)&&a.shouldExecuteOnCPU([p])){let t=a.tensorMap.get(p.dataId).values;switch(r){case"max":let i=tn(t,d.util.sizeFromShape(f),m,e.dtype);s=a.makeTensorInfo(m,e.dtype,i);break;case"prod":let{outVals:o,outShape:n,outDtype:u}=tc(p.shape,p.dtype,t,l);s=a.makeTensorInfo(n,u,o);break;default:throw Error(`${r} CPU implementation is not yet supported.`)}}else{let t=d.util.sizeFromShape(f),i=d.util.sizeFromShape(p.shape)/t,o=tV[r]||(0,d.sumOutType)(e.dtype),u=new tU({windowSize:t,inSize:t,batchSize:i,outSize:1},r,a.device.limits.maxComputeWorkgroupSizeX),l=a.runWebGPUProgram(u,[p],o,[{type:"int32",data:[t]}]);n.push(l),s=eV({inputs:{x:l},attrs:{shape:m},backend:a})}return n.forEach(e=>a.disposeData(e.dataId)),s}let tG={kernelName:d.All,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{keepDims:s,axis:o}=r;return tM(a,o,s,"all",i)}},tH={kernelName:d.Any,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{keepDims:s,axis:o}=r;return tM(a,o,s,"any",i)}};class tX{constructor(e,t,i){this.workgroupSize=[64,1,1],this.variableNames=["x"],this.uniforms="infinityValue : f32,",this.size=!0,this.op="min"===i?"<":">";let[r,a]=d.backend_util.computeOutAndReduceShapes(e,[t]);this.outputShape=0===r.length?[1]:r,this.dispatchLayout=L(this.outputShape),32>d.util.sizeFromShape(a)?(this.type="plain",this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize)):(this.type="shared",this.dispatch=D(this.dispatchLayout,this.outputShape,[1,1,1])),this.inputShape=e,this.shaderKey=`argMinMax_${this.op}_${this.type}`}getUserCode(){let e=this.workgroupSize[0],t=()=>1===this.inputShape.length?"uniforms.xShape":`uniforms.xShape.${C(this.inputShape.length-1)}`,i=()=>{let e="";if(1===this.outputShape.length)1!==this.inputShape.length&&(e+="outputCoords,");else for(let t=0;t<this.outputShape.length;t++)e+=`outputCoords.${C(t)},`;return e};if("shared"!==this.type)return`
      ${S("index")} {
        if (index < uniforms.size) {
          let outputCoords = getCoordsFromIndex(index);
          var bestIndex = 0;
          var bestValue = getX(${i()} 0);
          let reduceLength = ${t()};
          for (var i = 1; i < reduceLength; i++) {
            let candidate = getX(${i()} i);
            if (candidate ${this.op} bestValue) {
              bestValue = candidate;
              bestIndex = i;
            }
          }
          setOutputAtIndexI32(index, bestIndex);
        }
      }
      `;{let r=`
      var<workgroup> xBestIndices : array<i32, ${e}>;
      var<workgroup> xBestValues : array<f32, ${e}>;
    `;return`
      fn DIV_CEIL(a : u32, b : u32) -> u32 {
        return ((a - 1u) / b + 1u);
      }

      ${r}

      ${S("index")} {
        let outputIndex = index / ${e};
        let reduceLength = ${t()};

        var bestIndex = i32(localId.x);
        var bestValue = uniforms.infinityValue;
        let outputCoords = getCoordsFromIndex(outputIndex);
        for (var k = i32(localId.x); k < reduceLength && outputIndex < uniforms.size;
            k = k + ${e}) {
          let candidate = getX(${i()} k);
          if (!isnan(candidate) && candidate ${this.op} bestValue) {
            bestValue = candidate;
            bestIndex = k;
          }
        }
        xBestValues[localId.x] = bestValue;
        xBestIndices[localId.x] = bestIndex;
        workgroupBarrier();

        var reduceSize = min(u32(reduceLength), ${e}u);
        for (var currentSize = reduceSize / 2u; reduceSize > 1u;
            currentSize = reduceSize / 2u) {
          let interval = DIV_CEIL(reduceSize, 2u);
          if (localId.x < currentSize) {
            let candidate = xBestValues[localId.x + interval];
            if (candidate ${this.op} bestValue) {
              bestValue = candidate;
              xBestValues[localId.x] = bestValue;
              xBestIndices[localId.x] = xBestIndices[localId.x + interval];
            }
          }
          reduceSize = interval;
          workgroupBarrier();
        }

        if (localId.x == 0u && outputIndex < uniforms.size) {
          setOutputAtIndexI32(outputIndex, xBestIndices[localId.x]);
        }
      }
    `}}}let tK={kernelName:d.ArgMax,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s}=r,o=d.util.parseAxisParam(s,a.shape),n=d.backend_util.getAxesPermutation(o,a.shape.length),u=a,l=[];null!=n&&(l.push(u=tW({inputs:{x:a},backend:i,attrs:{perm:n}})),o=d.backend_util.getInnerMostAxes(o.length,u.shape.length)),d.backend_util.assertAxesAreInnerMostDims("argMax",[o[0]],u.shape.length);let h=new tX(u.shape,o[0],"max"),p=[{type:"float32",data:[Number.NEGATIVE_INFINITY]}],c=i.runWebGPUProgram(h,[u],"int32",p);return l.forEach(e=>i.disposeData(e.dataId)),c}},tq={kernelName:d.ArgMin,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s}=r,o=d.util.parseAxisParam(s,a.shape),n=d.backend_util.getAxesPermutation(o,a.shape.length),u=a,l=[];null!=n&&(l.push(u=tW({inputs:{x:a},backend:i,attrs:{perm:n}})),o=d.backend_util.getInnerMostAxes(o.length,u.shape.length)),d.backend_util.assertAxesAreInnerMostDims("argMin",[o[0]],u.shape.length);let h=new tX(u.shape,o[0],"min"),p=[{type:"float32",data:[Number.POSITIVE_INFINITY]}],c=i.runWebGPUProgram(h,[u],"int32",p);return l.forEach(e=>i.disposeData(e.dataId)),c}},tY=eJ({opType:n.ASIN}),tj={kernelName:d.Asin,backendName:"webgpu",kernelFunc:tY},tQ=eJ({opType:n.ASINH}),tZ={kernelName:d.Asinh,backendName:"webgpu",kernelFunc:tQ},tJ=eJ({opType:n.ATAN}),t2={kernelName:d.Atan,backendName:"webgpu",kernelFunc:tJ},t3=e2({opType:o.ATAN2}),t0={kernelName:d.Atan2,backendName:"webgpu",kernelFunc:t3},t1=eJ({opType:n.ATANH}),t4={kernelName:d.Atanh,backendName:"webgpu",kernelFunc:t1};class t6{constructor(e){this.variableNames=["x"],this.uniforms="strides : vec2<i32>,",this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="poolWithFilterSizeEqualsOne"}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let batch = coords[0];
          let d = coords[3];

          let xRCCorner = coords.yz * uniforms.strides;
          let xRCorner = xRCCorner.x;
          let xCCorner = xRCCorner.y;

          let value = getX(batch, xRCorner, xCCorner, d);
          setOutputAtIndex(index, value);
        }
      }
    `}}class t5{constructor(e,t,i=!1,r=!1,a=!1){if(this.variableNames=["x"],this.uniforms="strides : vec2<i32>, pads : vec2<i32>, dilations : vec2<i32>, convDims : vec2<i32>, filterDims : vec2<i32>,",this.workgroupSize=[128,1,1],this.size=!0,"avg"===t&&i)throw Error("Cannot compute positions for average pool.");this.outputShape=e.outShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.poolType=t,this.computePositions=i,this.flattenPositions=r,this.includeBatchIndex=a,this.shaderKey=`pool2D_${t}_${i}_${r}_${a}`}getUserCode(){let e;if("avg"===this.poolType)e="resultValue = resultValue + value; count = count + 1.0;";else if(this.computePositions){let t=this.flattenPositions?this.includeBatchIndex?"((batch * uniforms.xShape[1] + xR) * uniforms.xShape[2] + xC) * uniforms.xShape[3] + d":"(xR * uniforms.xShape[2] + xC) * uniforms.xShape[3] + d":"wR * uniforms.filterDims.y + wC";e=`let currMaxValue = mix(value, maxValue, maxValueFound);
      if (value >= currMaxValue) {
        maxValue = value;
        maxValueFound = 1.0;
        maxPosition = ${t};
      }`}else e="resultValue = max(value, resultValue);";let t="resultValue";return"avg"===this.poolType&&(t="resultValue / max(count, 1.0)"),`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
          let batch = coords[0];
          let d = coords[3];
          let xRCCorner = vec2<i32>(coords.yz) * uniforms.strides - uniforms.pads;
          let xRCorner = xRCCorner.x;
          let xCCorner = xRCCorner.y;

          ${this.computePositions?`var maxValue = 0.0;
            var maxValueFound = 0.0;
            var maxPosition = 0;`:`var resultValue = ${"avg"===this.poolType?"0.0":"-1.0 / pow(10.0, -20.0)"};`}

          var count = 0.0;
          for (var wR = 0; wR < uniforms.filterDims.x; wR = wR + uniforms.dilations.x) {
            let xR = xRCorner + wR;

            if (xR < 0 || xR >= uniforms.convDims.x) {
              continue;
            }

            for (var wC = 0; wC < uniforms.filterDims.y; wC = wC + uniforms.dilations.y) {
              let xC = xCCorner + wC;
              if (xC < 0 || xC >= uniforms.convDims.y) {
                continue;
              }

              let value = getX(batch, xR, xC, d);
              ${e}
            }
          }

          ${this.computePositions?"setOutputAtIndexI32(index, maxPosition);":`setOutputAtIndex(index, ${t});`}
        }
      }
    `}}class t8{constructor(e,t,i=!1,r=!1,a=!1){if(this.variableNames=["x"],this.uniforms="strides : vec3<i32>, pads : vec3<i32>, convDims : vec3<i32>, filterDims : vec3<i32>,",this.workgroupSize=[128,1,1],this.size=!0,"avg"===t&&i)throw Error("Cannot compute positions for average pool.");this.outputShape=e.outShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.poolType=t,this.computePositions=i,this.flattenPositions=r,this.includeBatchIndex=a,this.shaderKey=`pool3D_${t}_${i}_${r}_${a}`}getUserCode(){let e;if("avg"===this.poolType)e="resultValue += value; count += 1.0;";else if(this.computePositions){let t=this.flattenPositions?this.includeBatchIndex?"(((batch * uniforms.xShape.y + xD) * uniforms.xShape.z + xR) * uniforms.xShape.w + xC) * uniforms.xShape.u + ch":"((xD * uniforms.xShape.z + xR) * uniforms.xShape.w + xC) * uniforms.xShape.u + ch":"wD * uniforms.filterDims.y * uniforms.filterDims.y + wR * uniforms.filterDims.z + wC";e=`let currMaxValue = mix(value, maxValue, maxValueFound);
      if (value >= currMaxValue) {
        maxValue = value;
        maxValueFound = 1.0;
        maxPosition = ${t};
      }`}else e="resultValue = max(value, resultValue);";let t="resultValue";return"avg"===this.poolType&&(t="resultValue / max(count, 1.0)"),`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let batch = coords.x;
          let ch = coords.u;

          let xCorner = vec3<i32>(coords.y, coords.z, coords.w) * uniforms.strides - uniforms.pads;
          let xDCorner = xCorner.x;
          let xRCorner = xCorner.y;
          let xCCorner = xCorner.z;

          ${this.computePositions?`var maxValue = 0.0;
            var maxValueFound = 0.0;
            var maxPosition = 0;`:`var resultValue = ${"avg"===this.poolType?"0.0":"-1.0 / pow(10.0, -20.0)"};`}

          var count = 0.0;
          for (var wD = 0; wD < uniforms.filterDims.x; wD++) {
            let xD = xDCorner + wD;
            if (xD < 0 || xD >= uniforms.convDims.x) {
              continue;
            }

            for (var wR = 0; wR < uniforms.filterDims.y; wR++) {
              let xR = xRCorner + wR;
              if (xR < 0 || xR >= uniforms.convDims.y) {
                continue;
              }

              for (var wC = 0; wC < uniforms.filterDims.z; wC++) {
                let xC = xCCorner + wC;
                if (xC < 0 || xC >= uniforms.convDims.z) {
                  continue;
                }

                let value = getX(batch, xD, xR, xC, ch);
                ${e}
              }
            }
          }

          ${this.computePositions?"setOutputAtIndexI32(index, maxPosition);":`setOutputAtIndex(index, ${t});`}
        }
      }
    `}}function t9(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{reductionIndices:s,keepDims:o}=r;return tM(a,s,o,"max",i)}let t7={kernelName:d.Max,backendName:"webgpu",kernelFunc:t9};function ie(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{keepDims:s,axis:o}=r;return tM(a,o,s,"mean",i)}let it={kernelName:d.Mean,backendName:"webgpu",kernelFunc:ie};function ii(e,t,i,r){let a;if(1===t.filterWidth&&1===t.filterHeight&&d.util.arraysEqual(t.inShape,t.outShape))return eq({inputs:{x:e},backend:r});if(t.filterWidth===t.inWidth&&t.filterHeight===t.inHeight&&1===t.batchSize&&"VALID"===t.padInfo.type){let a;let s=e.shape.length,o=eV({inputs:{x:e},backend:r,attrs:{shape:[e.shape[s-3]*e.shape[s-2],e.shape[s-1]]}});"avg"===i?a=ie({inputs:{x:o},backend:r,attrs:{axis:0,keepDims:!1}}):(d.util.assert("max"===i,()=>`Invalid pool type ${i}`),a=t9({inputs:{x:o},backend:r,attrs:{reductionIndices:0,keepDims:!1}}));let n=eV({inputs:{x:a},backend:r,attrs:{shape:t.outShape}});return r.disposeData(o.dataId),r.disposeData(a.dataId),n}let s=[{type:"int32",data:[t.strideHeight,t.strideWidth]}];return 1===t.filterHeight&&1===t.filterWidth?a=new t6(t):("avg"===i?a=new t5(t,"avg"):(d.util.assert("max"===i,()=>`Invalid pool type ${i}`),a=new t5(t,"max")),s.push({type:"int32",data:[t.padInfo.top,t.padInfo.left]},{type:"int32",data:[t.dilationHeight,t.dilationWidth]},{type:"int32",data:[t.inHeight,t.inWidth]},{type:"int32",data:[t.effectiveFilterHeight,t.effectiveFilterWidth]})),r.runWebGPUProgram(a,[e],e.dtype,s)}let ir={kernelName:d.AvgPool,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dimRoundingMode:u}=r,l=d.backend_util.computePool2DInfo(a.shape,s,o,1,n,u);return ii(a,l,"avg",i)}},ia={kernelName:d.AvgPool3D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dataFormat:u,dimRoundingMode:l}=r,h=d.backend_util.computePool3DInfo(a.shape,s,o,[1,1,1],n,l,u),p=new t8(h,"avg"),c=[{type:"int32",data:[h.strideDepth,h.strideHeight,h.strideWidth]},{type:"int32",data:[h.padInfo.front,h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.inDepth,h.inHeight,h.inWidth]},{type:"int32",data:[h.effectiveFilterDepth,h.effectiveFilterHeight,h.effectiveFilterWidth]}];return i.runWebGPUProgram(p,[a],a.dtype,c)}};class is{constructor(e){this.variableNames=["dy"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, dilations : vec2<i32>, filterDims : vec2<i32>,
       outHeight : i32, outWidth : i32, avgMultiplier : f32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="avgPool2DBackprop"}getUserCode(){return`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d = coords[3];

        let dyRCCorner = vec2<i32>(coords.yz) - uniforms.pads;
        let dyRCorner = dyRCCorner.x;
        let dyCCorner = dyRCCorner.y;

        // Convolve dy(?, ?, d) with pos mask(:, :, d) to get dx(xR, xC, d).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var wR = 0; wR < uniforms.filterDims[0]; wR = wR + uniforms.dilations[0]) {
          let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[0]);

          if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
            continue;
          }
          let idyR = i32(dyR);

          for (var wC = 0; wC < uniforms.filterDims[1]; wC = wC + uniforms.dilations[1]) {
            let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[1]);

            if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
              continue;
            }
            let idyC = i32(dyC);

            let dyValue = getDy(batch, idyR, idyC, d);

            dotProd = dotProd + dyValue * uniforms.avgMultiplier;
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}class io{constructor(e){this.variableNames=["dy"],this.uniforms=`strides : vec3<i32>, pads : vec3<i32>, filterDims : vec3<i32>,
       outDepth : i32, outHeight : i32, outWidth : i32, avgMultiplier : f32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="avgPool3DBackprop"}getUserCode(){return`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords.x;
        let ch = coords.u;

        let dyCorner = vec3<i32>(coords.y, coords.z, coords.w) - uniforms.pads;
        let dyDCorner = dyCorner.x;
        let dyRCorner = dyCorner.y;
        let dyCCorner = dyCorner.z;

        // Convolve dy(?, ?, ?, d) with pos mask(:, :, :, ch) to get
        // dx(xD, xR, xC, ch).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var wD = 0; wD < uniforms.filterDims[0]; wD++) {
          let dyD = f32(dyDCorner + wD) / f32(uniforms.strides[0]);

          if (dyD < 0.0 || dyD >= f32(uniforms.outDepth) || fract(dyD) > 0.0) {
            continue;
          }
          let idyD = i32(dyD);

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[1]);

            if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
              continue;
            }
            let idyR = i32(dyR);

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[2]);

              if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
                continue;
              }
              let idyC = i32(dyC);

              let dyValue = getDy(batch, idyD, idyR, idyC, ch);
              dotProd += dyValue * uniforms.avgMultiplier;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}let iu={kernelName:d.AvgPool3DGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s}=t,{filterSize:o,strides:n,pad:u,dimRoundingMode:l}=r,h=d.backend_util.computePool3DInfo(s.shape,o,n,1,u,l),p=new io(h),c=1/(h.filterDepth*h.filterHeight*h.filterWidth),f=[{type:"int32",data:[h.strideDepth,h.strideHeight,h.strideWidth]},{type:"int32",data:[h.effectiveFilterDepth-1-h.padInfo.front,h.effectiveFilterHeight-1-h.padInfo.top,h.effectiveFilterWidth-1-h.padInfo.left]},{type:"int32",data:[h.effectiveFilterDepth,h.effectiveFilterHeight,h.effectiveFilterWidth]},{type:"int32",data:[h.outDepth]},{type:"int32",data:[h.outHeight]},{type:"int32",data:[h.outWidth]},{type:"float32",data:[c]}];return i.runWebGPUProgram(p,[a],s.dtype,f)}},il={kernelName:d.AvgPoolGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s}=t;W([a,s],"avgPoolGrad");let{filterSize:o,strides:n,pad:u}=r,l=d.backend_util.computePool2DInfo(s.shape,o,n,1,u),h=new is(l),p=1/(l.filterHeight*l.filterWidth),c=[{type:"int32",data:[l.strideHeight,l.strideWidth]},{type:"int32",data:[l.effectiveFilterHeight-1-l.padInfo.top,l.effectiveFilterWidth-1-l.padInfo.left]},{type:"int32",data:[l.dilationHeight,l.dilationWidth]},{type:"int32",data:[l.effectiveFilterHeight,l.effectiveFilterWidth]},{type:"int32",data:[l.outHeight]},{type:"int32",data:[l.outWidth]},{type:"float32",data:[p]}];return i.runWebGPUProgram(h,[a],s.dtype,c)}},id={kernelName:d.BatchMatMul,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{a,b:s}=t,{transposeA:o,transposeB:n}=r;return eG({a,b:s,transposeA:o,transposeB:n,backend:i})}};class ih{constructor(e,t){this.variableNames=["source"],this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.rank=t.length,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.start=e,this.uniforms=`start : ${b(e.length)}, `,this.shaderKey="slice"}getUserCode(){let e;let t=b(this.rank),i=function(e){if(1===e)return"sourceLoc";if(e<=6)return ip.slice(0,e).map(e=>`sourceLoc.${e}`).join(",");throw Error(`Slicing for rank ${e} is not yet supported`)}(this.rank);return e=1===this.start.length?this.outputShape.map((e,t)=>"sourceLoc = uniforms.start + coords;"):this.outputShape.map((e,t)=>`sourceLoc.${ip[t]} = uniforms.start.${C(t)} + coords.${ip[t]};`),`
      ${S("index")} {
        if (index < uniforms.size) {
          var sourceLoc : ${t};
          let coords = getCoordsFromIndex(index);
          ${e.join("\n")}
          setOutputAtIndex(index, getSource(${i}));
        }
      }
    `}}let ip=["x","y","z","w","u","v"];function ic(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{begin:s,size:o}=r,[n,u]=d.slice_util.parseSliceParams(a,s,o);if(d.slice_util.assertParamsValid(a,n,u),i.shouldExecuteOnCPU([a])||"string"===a.dtype){let e=ty(i.tensorMap.get(a.dataId).values,n,u,a.shape,a.dtype);return i.makeTensorInfo(u,a.dtype,e)}if(0===d.util.sizeFromShape(u))return i.makeTensorInfo(u,a.dtype,[]);let l=new ih(n,u),h=[{type:"int32",data:n}];return i.runWebGPUProgram(l,[a],a.dtype,h)}let im={kernelName:d.Slice,backendName:"webgpu",kernelFunc:ic},ig={kernelName:d.BatchToSpaceND,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{blockShape:s,crops:o}=r;d.util.assert(a.shape.length<=4,()=>"batchToSpaceND for rank > 4 with a WebGPU backend not implemented yet");let n=s.reduce((e,t)=>e*t),u=d.backend_util.getReshaped(a.shape,s,n),l=d.backend_util.getPermuted(u.length,s.length),h=d.backend_util.getReshapedPermuted(a.shape,s,n),p=d.backend_util.getSliceBeginCoords(o,s.length),c=d.backend_util.getSliceSize(h,o,s.length),f=[],m=eV({inputs:{x:a},backend:i,attrs:{shape:u}}),g=tW({inputs:{x:m},backend:i,attrs:{perm:l}}),x=eV({inputs:{x:g},backend:i,attrs:{shape:h}}),y=ic({inputs:{x:x},backend:i,attrs:{begin:p,size:c}});return f.push(m),f.push(g),f.push(x),f.forEach(e=>i.disposeData(e.dataId)),y}},ix=`
  fn bincount_write(index: i32, value: f32) {
    ${x("&result[index]","value","float32")}
  }
`,iy=`
  fn bincount_write(index: i32, value: f32) {
    atomicStore(&result[index], bitcast<i32>(value));
  }
`;class iw{constructor(e,t,i=!1){this.outputShape=[],this.variableNames=["x"],this.uniforms="binCountSize : i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.hasWeights=!0,this.binaryOutput=!1,this.outputShape=e,this.rank=e.length,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.binaryOutput=i,i&&(this.atomic=!1),this.hasWeights=t,this.hasWeights&&this.variableNames.push("w"),this.shaderKey=`bincount_${this.hasWeights}_${this.binaryOutput}_${this.rank}`}getUserCode(){return`
    ${this.binaryOutput?iy:ix}
  ${S("index")} {
    ${1===this.rank?`if (index < uniforms.xShape) {
      let indexVal = i32(getX(index));
      if (indexVal < uniforms.binCountSize) {
        let value = ${this.binaryOutput?1:this.hasWeights?"getW(index)":"1."};
        bincount_write(indexVal, value);
      }
    }`:`let coord = getCoordsFromIndex(index);
    if (coordsInBounds2D(coord, uniforms.xShape)) {
      let indexVal = i32(getX(coord[0], coord[1]));
      if (indexVal < uniforms.binCountSize) {
        let value = ${this.binaryOutput?1:this.hasWeights?"getW(coord[0], coord[1])":"1."};
        bincount_write(coord.x * uniforms.binCountSize + indexVal, value);
      }
    }`}
  }
  `}}let ib={kernelName:d.Bincount,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,weights:s}=t,{size:o}=r,n=d.util.sizeFromShape(a.shape),u=d.util.sizeFromShape(s.shape)>0,l=s.dtype,h=eO({backend:i,attrs:{shape:[o],value:0,dtype:l}}),p=new iw([n],u),c=[{type:"int32",data:[o]}],f=u?[a,s]:[a];return i.runWebGPUProgram(p,f,l,c,h)}};class iC{constructor(e){this.outputShape=[],this.variableNames=["s0","s1"],this.uniforms="s0Size : i32, s1Size : i32, ",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="broadcastArgs"}getUserCode(){return`
  ${S("index")} {
    if (index < uniforms.size) {
      var s0 = 1.0;
      var s1 = 1.0;
      let indexS0 = index - uniforms.size + uniforms.s0Size;
      let indexS1 = index - uniforms.size + uniforms.s1Size;
      if (indexS0 >= 0) {
        s0 = getS0(indexS0);
      }
      if (indexS1 >= 0) {
        s1 = getS1(indexS1);
      }

      if (s0 == 1.0) {
        setOutputAtIndex(index, s1);
      } else if (s1 == 1.0) {
        setOutputAtIndex(index, s0);
      } else if (s0 != s1) {
        setOutputAtIndex(index, uniforms.NAN);
      } else {
        setOutputAtIndex(index, s0);
      }
    }
  }
  `}}let iS={kernelName:d.BroadcastArgs,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{s0:r,s1:a}=t;if(i.shouldExecuteOnCPU([r,a])){let e=i.tensorMap.get(r.dataId),t=i.tensorMap.get(a.dataId),s=e.values,o=t.values,n=d.backend_util.assertAndGetBroadcastShape(Array.from(s),Array.from(o));return i.makeTensorInfo([n.length],"int32",Int32Array.from(n))}let s=d.util.sizeFromShape(r.shape),o=d.util.sizeFromShape(a.shape),n=new iC(Math.max(s,o)),u=[{type:"int32",data:[s]},{type:"int32",data:[o]}];return i.runWebGPUProgram(n,[r,a],"int32",u)}},iv=e2({opType:o.NOT_EQUAL,dtype:"bool",cpuKernelImpl:tp}),iI={kernelName:d.NotEqual,backendName:"webgpu",kernelFunc:iv};function ik(e){let{inputs:t,backend:i}=e,{input:r}=t;return eq({inputs:{x:i.tensorMap.get(r.dataId).complexTensorInfos.real},backend:i})}let iR={kernelName:d.Real,backendName:"webgpu",kernelFunc:ik},i$={kernelName:d.Cast,backendName:"webgpu",kernelFunc:function e(t){let{inputs:i,backend:r,attrs:a}=t,{x:s}=i,{dtype:o}=a;if("complex64"===o){if("complex64"===s.dtype)return eq({inputs:{x:s},backend:r});let t=d.zeros(s.shape),i=e({inputs:{x:s},backend:r,attrs:{dtype:"float32"}}),a=ej({inputs:{real:i,imag:t},backend:r});return t.dispose(),r.disposeData(i.dataId),a}if("complex64"===s.dtype){let t=ik({inputs:{input:s},backend:r}),i=e({inputs:{x:t},backend:r,attrs:{dtype:o}});return r.disposeData(t.dataId),i}if(!d.util.hasEncodingLoss(s.dtype,o)){let e=eq({inputs:{x:s},backend:r});return{dataId:e.dataId,shape:e.shape,dtype:o}}if(r.shouldExecuteOnCPU([s])){let[e,t,i]=e0(r.tensorMap.get(s.dataId).values,s.shape,s.dtype,o);return r.makeTensorInfo(e,t,i)}if("int32"===o)return function(e,t){let i=new eZ(e.shape,n.TO_INT),r=t.runWebGPUProgram(i,[e],"int32");return{dataId:r.dataId,shape:r.shape,dtype:r.dtype}}(s,r);if("bool"===o){let e=r.makeTensorInfo([],"bool",d.util.getTypedArrayFromDType("bool",1)),t=iv({inputs:{a:s,b:e},backend:r});return r.disposeData(e.dataId),t}throw Error(`Error in Cast: failed to cast ${s.dtype} to ${o}`)}},iP=eJ({opType:n.CEIL,cpuKernelImpl:e1}),iz={kernelName:d.Ceil,backendName:"webgpu",kernelFunc:iP};class iN{constructor(e){this.variableNames=["A"],this.uniforms="minVal : f32, maxVal : f32,",this.workPerThread=4,this.workgroupSize=[64,1,1],this.outputComponent=4,this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.shaderKey="clipVec4"}getUserCode(){return`
      ${S("index")} {
        if(index < uniforms.size) {
          let value = getAByOutputIndex(index);
          var clampedValue = clamp(
              value, vec4<f32>(uniforms.minVal), vec4<f32>(uniforms.maxVal));
          clampedValue = select(clampedValue, value, isnanVec4(value));
          setOutputAtIndex(index, clampedValue);
        }
      }
    `}}class iA{constructor(e){this.variableNames=["A"],this.uniforms="minVal : f32, maxVal : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="clip"}getUserCode(){return`
      ${S("index")} {
        if(index < uniforms.size) {
          let value = getAByOutputIndex(index);
          if (isnan(value)) {
            setOutputAtIndex(index, value);
            return;
          }
          setOutputAtIndex(index, clamp(value, uniforms.minVal, uniforms.maxVal));
        }
      }
    `}}let iD={kernelName:d.ClipByValue,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s}=i,{clipValueMin:o,clipValueMax:n}=a;return t=d.util.sizeFromShape(s.shape)%4==0?new iN(s.shape):new iA(s.shape),r.runWebGPUProgram(t,[s],s.dtype,[{type:"float32",data:[o]},{type:"float32",data:[n]}])}};class iF{constructor(e){this.outputShape=[],this.variableNames=["real","imag"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="complexAbs"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.size) {
        let re = abs(getRealByOutputIndex(index));
        let im = abs(getImagByOutputIndex(index));
        let mx = max(re, im);

        // The length function in wgsl may be not underflow-safe on some GPUs.
        // So the safe solution is to ensure underflow-safety in all cases.
        setOutputAtIndex(index, select(mx * length(vec2<f32>(1, min(re, im)/mx)), 0.0, mx == 0.0));
      }
    }
  `}}function i_(e,t){return{dataId:t.dataId,dtype:t.dtype,shape:e.shape}}let iT={kernelName:d.ComplexAbs,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r}=t,a=i.tensorMap.get(r.dataId),s=new iF(r.shape),o=[i_(r,a.complexTensorInfos.real),i_(r,a.complexTensorInfos.imag)];return i.runWebGPUProgram(s,o,o[0].dtype)}};class iL{constructor(e){this.uniforms="",this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=d.backend_util.computeOutShape(e,1),this.variableNames=e.map((e,t)=>`T${t}`),this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]),this.offsetLength=e.length-1;for(let e=0;e<this.offsetLength;e++)this.uniforms+=`offset${e} : i32,`;this.shaderKey="concat"}getUserCode(){let e=[];if(this.offsetLength>0){e.push("if (yC < uniforms.offset0){ setOutputAtCoords(coords.x, coords.y, getT0(yR, yC)); }");for(let t=1;t<this.offsetLength;t++)e.push(`else if (yC < uniforms.offset${[t]}){ setOutputAtCoords(coords.x, coords.y, getT${t}(yR, yC - uniforms.offset${t-1})); }`);let t=this.offsetLength,i=this.offsetLength-1;e.push(`else { setOutputAtCoords(coords.x, coords.y, getT${t}(yR, yC - uniforms.offset${i})); }`)}else e.push("setOutputAtCoords(coords.x, coords.y, getT0(yR, yC));");return`
      ${S("index")} {
        for(var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let flatIndex = index * ${this.workPerThread} + i;
          if(flatIndex < uniforms.size) {
            let coords = getCoordsFromIndex(flatIndex);
            let yR = coords.x;
            let yC = coords.y;

            ${e.join("\n        ")}
          }
        }
      }
    `}}function iE(e){let{inputs:t,backend:i}=e,{input:r}=t;return eq({inputs:{x:i.tensorMap.get(r.dataId).complexTensorInfos.imag},backend:i})}let iB={kernelName:d.Imag,backendName:"webgpu",kernelFunc:iE};function iW(e){let{inputs:t,backend:i,attrs:r}=e,{axis:a}=r,s=d.util.parseAxisParam(a,t[0].shape)[0],o=t.map(e=>e.shape);d.backend_util.assertParamsConsistent(o,s);let n=d.backend_util.computeOutShape(t.map(e=>e.shape),s);if(0===d.util.sizeFromShape(n))return i.makeTensorInfo(n,t[0].dtype,[]);let u=t.filter(e=>d.util.sizeFromShape(e.shape)>0);return 1===u.length?eq({inputs:{x:u[0]},backend:i}):function e(t,i,r){let a=t[0].dtype;if("complex64"===a){let a=t.map(e=>ik({inputs:{input:e},backend:r})),s=t.map(e=>iE({inputs:{input:e},backend:r})),o=e(a,i,r),n=e(s,i,r),u=ej({inputs:{real:o,imag:n},backend:r});return a.forEach(e=>r.disposeData(e.dataId)),s.forEach(e=>r.disposeData(e.dataId)),r.disposeData(o.dataId),r.disposeData(n.dataId),u}let s=r.shouldExecuteOnCPU(t);if("string"===a&&(s=!0),s){let e=t.map(e=>{let t=d.util.sizeFromShape(e.shape.slice(i));return eV({inputs:{x:e},backend:r,attrs:{shape:[-1,t]}})}),s=e4(e.map(e=>({vals:r.readSync(e.dataId),shape:e.shape})),d.backend_util.computeOutShape(e.map(e=>e.shape),1),a,1===e[0].shape[0]),o=d.backend_util.computeOutShape(t.map(e=>e.shape),i),n=r.makeTensorInfo(o,a,s);return e.forEach(e=>r.disposeData(e.dataId)),n}let o=r.device.limits.maxStorageBuffersPerShaderStage-1;if(t.length>o){let a=[];for(let s=0;s<t.length;s+=o){let n=t.slice(s,s+o);a.push(e(n,i,r))}let s=e(a,i,r);for(let e of a)r.disposeData(e.dataId);return s}let{tensors2D:n,outShape:u}=function(e,t,i){let r=d.backend_util.computeOutShape(e.map(e=>e.shape),t);return{tensors2D:e.map(e=>eV({inputs:{x:e},backend:i,attrs:{shape:[d.util.sizeFromShape(e.shape.slice(0,t)),d.util.sizeFromShape(e.shape.slice(t))]}})),outShape:r}}(t,i,r),l=n.map(e=>e.shape),h=new iL(l),p=[],c=Array(l.length-1);if(c.length>0){c[0]=l[0][1],p.push({type:"int32",data:[c[0]]});for(let e=1;e<c.length;e++)c[e]=c[e-1]+l[e][1],p.push({type:"int32",data:[c[e]]})}let f=r.runWebGPUProgram(h,n,n[0].dtype,p);n.forEach(e=>r.disposeData(e.dataId));let m=eV({inputs:{x:f},backend:r,attrs:{shape:u}});return r.disposeData(f.dataId),m}(u,s,i)}let iO={kernelName:d.Concat,backendName:"webgpu",kernelFunc:iW};class iU{constructor(e,t,i,r,a=!1,s=null,o=!1,n=!1){this.variableNames=["x","W"],this.uniforms="filterDims : vec2<i32>, pads : vec2<i32>, strides : vec2<i32>, dilations : vec2<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.outputShape=e.outShape,this.isChannelsLast="channelsLast"===e.dataFormat,this.isVec4=((e.inChannels%4==0||e.inChannels%3==0)&&this.isChannelsLast||e.outWidth%4==0&&!this.isChannelsLast)&&e.outChannels%4==0,this.dispatchLayout=this.isChannelsLast?{x:[3],y:[1,2],z:[0]}:{x:[2,3],y:[1],z:[0]},this.workgroupSize=_(this.dispatchLayout,this.outputShape,this.isVec4),this.elementsPerThread=T(this.dispatchLayout,this.outputShape,this.isVec4),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,this.elementsPerThread),this.isVec4?(this.outputComponent=4,this.isChannelsLast&&e.inChannels%4!=0?(this.innerElementSize=3,this.variableComponents=[1,4]):(this.innerElementSize=4,this.variableComponents=[4,4]),a&&(this.variableNames.push("bias"),this.variableComponents.push(4)),o&&(this.variableNames.push("preluActivationWeights"),this.variableComponents.push(4))):(this.innerElementSize=this.elementsPerThread[0],a&&this.variableNames.push("bias"),o&&this.variableNames.push("preluActivationWeights")),this.sequentialAccessByThreads=n,this.addBias=a,this.activation=s,this.hasPreluActivationWeights=o,this.tileAOuter=this.workgroupSize[1]*this.elementsPerThread[1],this.tileBOuter=this.workgroupSize[0]*this.elementsPerThread[0],this.tileInner=Math.max(this.workgroupSize[0]*this.innerElementSize,this.workgroupSize[1]),this.fitAOuter=t%this.tileAOuter==0,this.fitBOuter=i%this.tileBOuter==0,this.fitInner=r%this.tileInner==0,this.shaderKey=`conv2DMM_${this.elementsPerThread}_${this.activation}}_${this.fitAOuter}_${this.fitBOuter}_${this.fitInner}_${this.isVec4}_${this.innerElementSize}_${this.isChannelsLast}_${this.sequentialAccessByThreads}`}getUserCode(){let e=this.isVec4?ez(this.elementsPerThread,this.workgroupSize,!this.isChannelsLast,this.tileInner):eD(this.elementsPerThread,this.workgroupSize,!this.isChannelsLast,this.tileInner,!1,null,this.sequentialAccessByThreads),t=this.isVec4?[this.innerElementSize,4,4]:[1,1,1];return`
    ${function(e,t,i,r,a=!1,s=null,o=!1,n=4,u=4,l=4){let d=e?`
      let coord = vec4<i32>(batch, xRow, xCol, xCh);
      `:`
      let coord = vec4<i32>(batch, xCh, xRow, xCol);
      `,h=e?`
      let coords = vec4<i32>(
        batch,
        row / outWidth,
        row % outWidth,
        col);
      `:`
      let coords = vec4<i32>(
        batch,
        row,
        col / outWidth,
        col % outWidth);
      `,p=e?"row":"col",c=e?"col":"row",f=`
      let inChannels = uniforms.wShape[2];
      let outWidth = ${e?"uniforms.outShape[2]":"uniforms.outShape[3]"};
      let outRow = ${p} / outWidth;
      let outCol = ${p} % outWidth;

      let WRow = ${c} / (uniforms.filterDims[1] * inChannels);
      let WCol = ${c} / inChannels % uniforms.filterDims[1];
      let xRow = outRow * uniforms.strides[0] + uniforms.dilations[0] * WRow - uniforms.pads[0];
      let xCol = outCol * uniforms.strides[1] + uniforms.dilations[1] * WCol - uniforms.pads[1];
      let xCh = ${c} % inChannels;
      var resData = ${w(n)}(0.0);
      // The bounds checking is always needed since we use it to pad zero for
      // the 'same' padding type.
      if (xRow >= 0 && xRow < ${e?"uniforms.xShape[1]":"uniforms.xShape[2]"} && xCol >= 0 && xCol < ${e?"uniforms.xShape[2]":"uniforms.xShape[3]"}) {
        ${d}
        let xIndex = getIndexFromCoords4D(coord, uniforms.xShape);
        ${(e=>{switch(e){case 1:return"resData = f32(x[xIndex]);";case 3:return"resData = vec3<f32>(x[xIndex], x[xIndex + 1], x[xIndex + 2]);";case 4:return"resData = vec4<f32>(x[xIndex / 4]);";default:throw Error(`innerElementSize ${e} is not supported.`)}})(n)}
      }
      return resData;`,m=e?t&&r?`
      ${f}`:`
      if (row < uniforms.dimAOuter && col < uniforms.dimInner) {
        ${f}
      }
      return ${w(n)}(0.0);`:r&&i?`
      ${f}`:`
      if (row < uniforms.dimInner && col < uniforms.dimBOuter) {
        ${f}
      }
      return ${w(n)}(0.0);`,g=`${(e=>{switch(e){case 1:return"return f32(W[row * uniforms.wShape[3] + col]);";case 4:return"return vec4<f32>(W[(row * uniforms.wShape[3] + col) / 4]);";default:throw Error(`innerElementSize ${e} is not supported.`)}})(u)}`,x=w(l),y=e?w(n):w(u),b=e?w(u):w(n);return`
      ${ev(s,o,4===l,4)}
      fn mm_readA(batch: i32, row : i32, col : i32) -> ${y} {
        ${e?m:g}
      }

      fn mm_readB(batch: i32, row : i32, col : i32) -> ${b} {
        ${e?g:m}
      }

      fn mm_write(batch: i32, row : i32, col : i32, valueIn : ${x}) {
        if (row < uniforms.dimAOuter && col < uniforms.dimBOuter)
        {
        var value = valueIn;
        let outWidth = ${e?"uniforms.outShape[2]":"uniforms.outShape[3]"};
        ${h}
        ${eI(a,s)}
        setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
        }
      }`}(this.isChannelsLast,this.fitAOuter,this.fitBOuter,this.fitInner,this.addBias,this.activation,this.hasPreluActivationWeights,t[0],t[1],t[2])}
    ${e}
  `}}class iV{constructor(e,t=!1,i=null,r=!1){this.variableNames=["x","W"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>,",this.workgroupSize=[4,4,8],this.outputShape=e.outShape,this.isChannelsLast="channelsLast"===e.dataFormat,this.dispatchLayout=this.isChannelsLast?{x:[2],y:[1],z:[0,3]}:{x:[3],y:[2],z:[0,1]},this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.addBias=t,this.activation=i,this.hasPreluActivationWeights=r,t&&this.variableNames.push("bias"),r&&this.variableNames.push("preluActivationWeights"),this.shaderKey=`conv2dnaive_${this.activation}_${this.isChannelsLast}`}getUserCode(){return`
       ${ev(this.activation,this.hasPreluActivationWeights,!1,4)}
       fn readInp(batch : i32, row : i32, col : i32, chan : i32) -> f32{
         let coords = vec4<i32>(batch, row, col, chan);
         if (coordsInBounds4D(coords, uniforms.xShape)) {
           return  getX(batch, row, col, chan);
         } else {
          return 0.0;
         }
       }
       fn readFilt(row : i32, col : i32, xChannel : i32, outChannel : i32) -> f32{
         let coords = vec4<i32>(row, col, xChannel, outChannel);
         if(coordsInBounds4D(coords, uniforms.wShape)) {
           return getW(row, col, xChannel, outChannel);
          } else {
            return 0.0;
          }
       }
       fn writeResult(batch : i32, row : i32, col : i32, chan : i32, valueIn : f32) {
         let coords = ${this.isChannelsLast?"vec4<i32>(batch, row, col, chan);":"vec4<i32>(batch, chan, row, col);"}
         if (coordsInBounds4D(coords, uniforms.outShape)) {
           var value = valueIn;
           ${eI(this.addBias,this.activation)}
           setOutputAtCoords(coords.x, coords.y, coords.z, coords.w, value);
         }
       }
       ${S("index")} {
         let coords = getOutputCoords();
         let batch = coords[0];
         let outChannel = ${this.isChannelsLast?"coords[3];":"coords[1];"}
         let outRow = ${this.isChannelsLast?"coords[1];":"coords[2];"}
         let outCol = ${this.isChannelsLast?"coords[2];":"coords[3];"}
         var acc : f32 = 0.0;
         for (var row = 0; row < uniforms.filterDims[0]; row = row + 1) {
           for (var col = 0; col < uniforms.filterDims[1]; col = col + 1) {
             let xRow = outRow * uniforms.strides[0] + uniforms.dilations[0] * row - uniforms.pads[0];
             let xCol = outCol * uniforms.strides[1] + uniforms.dilations[1] * col - uniforms.pads[1];
             for (var xChannel = 0; xChannel < ${this.isChannelsLast?"uniforms.xShape[3];":"uniforms.xShape[1];"} xChannel = xChannel + 1) {
               ${this.isChannelsLast?"let v = readInp(batch, xRow, xCol, xChannel);":"let v = readInp(batch, xChannel, xRow, xCol);"}
               let f = readFilt(row, col, xChannel, outChannel);
               acc = acc + v * f;
             }
           }
         }
         writeResult(batch, outRow, outCol, outChannel, acc);
       }
     `}}class iM{constructor(e,t){this.variableNames=["x"],this.uniforms=`pads : vec2<i32>, strides : vec2<i32>, dilations : vec2<i32>, outWidth : i32, itemsPerBlockRow : i32,
       inChannels : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.isChannelsLast=t,this.shaderKey=`im2col_${this.isChannelsLast}`}getUserCode(){let e=this.isChannelsLast?1:2,t=this.isChannelsLast?2:3,i=this.isChannelsLast?"coords[1]":"coords[2]",r=this.isChannelsLast?"coords[2]":"coords[1]",a=this.isChannelsLast?"getX(batch, xRow, xCol, ch)":"getX(batch, ch, xRow, xCol)";return`
    ${S("index")} {
      let coords = getCoordsFromIndex(index);
      if(index < uniforms.size) {
        let batch = coords[0];
        let row = ${i};
        let col = ${r};
        let offsetY = (row / uniforms.outWidth) * uniforms.strides[0] - uniforms.pads[0];
        let xRow = offsetY + uniforms.dilations[0] * (col / uniforms.itemsPerBlockRow);
        var value = 0.0;
        if(xRow < uniforms.xShape[${e}] && xRow >= 0) {
          let offsetX = (row % uniforms.outWidth) * uniforms.strides[1] -
              uniforms.pads[1];
          let xCol = offsetX + uniforms.dilations[1] * ((col %
              uniforms.itemsPerBlockRow) / uniforms.inChannels);
          let ch = col % uniforms.inChannels;
          if(xCol < uniforms.xShape[${t}] && xCol >= 0) {
            value = ${a};
          }
        }
        setOutputAtIndex(index, value);
      }
    }
   `}}function iG(e,t){let i=e.length;return i>=3?t?[...e.slice(0,-3),e[i-3]*e[i-2],e[i-1]]:[...e.slice(0,-3),e[i-3],e[i-2]*e[i-1]]:!t&&1===i&&e[0]>1?[e[0],1]:null}function iH({x:e,filter:t,convInfo:i,backend:r,bias:a=null,preluActivationWeights:s=null,leakyreluAlpha:o=0,activation:n=null}){let u;let l=null!=a,h=null!=s,p="channelsLast"===i.dataFormat,c=p&&i.filterHeight===i.inHeight&&i.filterWidth===i.inWidth&&"VALID"===i.padInfo.type,f=(0,d.env)().getBool("WEBGPU_USE_NAIVE_CONV2D_DEBUG");if(!f&&(c||1===i.filterHeight&&1===i.filterWidth&&1===i.dilationHeight&&1===i.dilationWidth&&1===i.strideHeight&&1===i.strideWidth&&("SAME"===i.padInfo.type||"VALID"===i.padInfo.type)))return function({x:e,filter:t,convInfo:i,backend:r,bias:a=null,preluActivationWeights:s=null,leakyreluAlpha:o=0,activation:n=null}){let u,l;let d="channelsLast"===i.dataFormat,h=d&&i.filterHeight===i.inHeight&&i.filterWidth===i.inWidth&&"VALID"===i.padInfo.type,p=[];if(h){let a=i.inHeight*i.inWidth*i.inChannels;u=eV({inputs:{x:e},backend:r,attrs:{shape:[1,i.batchSize,a]}}),l=eV({inputs:{x:t},backend:r,attrs:{shape:[1,a,i.outChannels]}})}else u=eV({inputs:{x:e},backend:r,attrs:{shape:d?[i.batchSize,i.inHeight*i.inWidth,i.inChannels]:[i.batchSize,i.inChannels,i.inHeight*i.inWidth]}}),l=eV({inputs:{x:t},backend:r,attrs:{shape:[1,i.inChannels,i.outChannels]}});if(p.push(u),p.push(l),null!=s){let e=iG(s.shape,d);null!=e&&(s=eV({inputs:{x:s},backend:r,attrs:{shape:e}}),p.push(s))}if(null!=a){let e=iG(a.shape,d);null!=e&&(a=eV({inputs:{x:a},backend:r,attrs:{shape:e}}),p.push(a))}let c=eG({a:d?u:l,b:d?l:u,transposeA:!d,transposeB:!1,backend:r,bias:a,activation:n,preluActivationWeights:s,leakyreluAlpha:o}),f=eV({inputs:{x:c},backend:r,attrs:{shape:i.outShape}});for(let e of(p.push(c),p))r.disposeData(e.dataId);return f}({x:e,filter:t,convInfo:i,backend:r,bias:a,activation:n,preluActivationWeights:s,leakyreluAlpha:o});let m=(0,d.env)().getNumber("WEBGPU_THRESHOLD_TO_INCREASE_WORKGROUPS_FOR_MATMUL"),g=m>-1?m:r.thresholdToIncreaseWorkgroups,x=i.batchSize*Math.ceil(i.outHeight*i.outWidth/32)*Math.ceil(i.outChannels/32);if((0,d.env)().getBool("WEBGPU_CONV_SEPARATE_IM2COL_SHADER")||x<=g)return function({x:e,filter:t,convInfo:i,backend:r,bias:a=null,preluActivationWeights:s=null,leakyreluAlpha:o=0,activation:n=null}){let{filterWidth:u,filterHeight:l,inChannels:d,strideWidth:h,strideHeight:p,padInfo:c,outWidth:f,outHeight:m,dilationWidth:g,dilationHeight:x,dataFormat:y}=i,w="channelsLast"===y,b=u*l*d,C=m*f,S=new iM(w?[i.batchSize,C,b]:[i.batchSize,b,C],w),v=[{type:"int32",data:[c.top,c.left]},{type:"int32",data:[p,h]},{type:"int32",data:[x,g]},{type:"int32",data:[f]},{type:"int32",data:[d*u]},{type:"int32",data:[d]}],I=r.runWebGPUProgram(S,[e],e.dtype,v),k=[];k.push(I);let R=eV({inputs:{x:t},backend:r,attrs:{shape:[1,b,-1]}});if(k.push(R),null!=s){let e=iG(s.shape,w);null!=e&&(s=eV({inputs:{x:s},backend:r,attrs:{shape:e}}),k.push(s))}if(null!=a){let e=iG(a.shape,w);null!=e&&(a=eV({inputs:{x:a},backend:r,attrs:{shape:e}}),k.push(a))}let $=eG({a:w?I:R,b:w?R:I,transposeA:!w,transposeB:!1,backend:r,bias:a,activation:n,preluActivationWeights:s,leakyreluAlpha:o}),P=eV({inputs:{x:$},backend:r,attrs:{shape:i.outShape}});for(let e of(k.push($),k))r.disposeData(e.dataId);return P}({x:e,filter:t,convInfo:i,backend:r,bias:a,preluActivationWeights:s,leakyreluAlpha:o,activation:n});let y=[i.padInfo.top,i.padInfo.left],w=[{type:"int32",data:[i.filterHeight,i.filterWidth]},{type:"int32",data:[...y]},{type:"int32",data:[i.strideHeight,i.strideWidth]},{type:"int32",data:[i.dilationHeight,i.dilationWidth]}];if(f)u=new iV(i,l,n,h);else{let e=p?i.outHeight*i.outWidth:i.outChannels,t=p?i.outChannels:i.outHeight*i.outWidth,a=i.filterHeight*i.filterWidth*i.inChannels;w.push({type:"int32",data:[e]},{type:"int32",data:[t]},{type:"int32",data:[a]}),u=new iU(i,e,t,a,l,n,h,r.adapterInfo.isIntel())}let b=[],C=[e,t];l&&(p||1!==a.shape.length||b.push(a=eV({inputs:{x:a},backend:r,attrs:{shape:[a.shape[0],1,1]}})),C.push(a)),h&&(p||1!==s.shape.length||b.push(s=eV({inputs:{x:s},backend:r,attrs:{shape:[s.shape[0],1,1]}})),C.push(s)),"leakyrelu"===n&&(w.push({type:"float32",data:[o]}),u.uniforms+=" alpha : f32,");let S=r.runWebGPUProgram(u,C,e.dtype,w);for(let e of b)r.disposeData(e.dataId);return S}let iX={kernelName:d.Conv2D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,attrs:i,backend:r}=e,{x:a,filter:s}=t,{strides:o,pad:n,dataFormat:u,dilations:l,dimRoundingMode:h}=i,p=d.backend_util.convertConv2DDataFormat(u),c=d.backend_util.computeConv2DInfo(a.shape,s.shape,o,l,n,h,!1,p);return iH({x:a,filter:s,convInfo:c,backend:r})}};class iK{constructor(e){this.variableNames=["dy","W"],this.uniforms="filterDims : vec2<i32>, pads : vec2<i32>, strides : vec2<i32>, outBackprop : vec4<i32>,",this.workgroupSize=[64,1,1],this.size=!1,this.isVec4=!1,this.workPerThread=1,this.outputShape=e.inShape,this.isChannelsLast="channelsLast"===e.dataFormat,this.isVec4=this.isChannelsLast&&e.outChannels%4==0&&e.inChannels%4==0,this.isVec4?(this.workPerThread=2,this.outputComponent=4,this.workgroupSize=[4,4,4],this.dispatchLayout={x:[3],y:[2],z:[0,1]},this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[4,this.workPerThread,1])):(this.size=!0,this.workPerThread=1,this.workgroupSize=[64,1,1],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize)),this.shaderKey=`conv2DDerInput_${this.isChannelsLast}_${this.isVec4}_${this.workPerThread}`}getUserCode(){let e=this.isChannelsLast?1:2,t=this.isChannelsLast?2:3,i=this.isChannelsLast?3:1,r=`
    ${S()} {
      let batch = i32(globalId.z) / uniforms.outShape[1];
      let r = i32(globalId.z) % uniforms.outShape[1];
      let c = i32(globalId.y) * ${this.workPerThread};
      let d1 = i32(globalId.x) * 4;

      let dyCorner = vec2<i32>(r, c) - uniforms.pads;

      // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
      // ? = to be determined. : = across all values in that axis.
      var dotProd: array<vec4<f32>, ${this.workPerThread}>;
      for (var i = 0; i < ${this.workPerThread}; i++) {
        dotProd[i] = vec4<f32>(0.0);
      }
      for (var wR = 0; wR < uniforms.filterDims.x; wR = wR + 1) {
        let dyR = f32(dyCorner.x + wR) / f32(uniforms.strides.x);
        let wRPerm = uniforms.filterDims.x - 1 - wR;
        if (dyR < 0.0 || dyR >= f32(uniforms.outBackprop[1]) ||
            fract(dyR) > 0.0) {
          continue;
        }
        let idyR = i32(dyR);

        for (var wC = 0; wC < uniforms.filterDims.y; wC = wC + 1) {
          let dyC = f32(dyCorner.y + wC) / f32(uniforms.strides.y);
          let dyC2 = f32(dyCorner.y + 1 + wC) / f32(uniforms.strides.y);
          let wCPerm = uniforms.filterDims.y - 1 - wC;
          var bDyCVal = true;
          var bDyCVal2 = true;
          if (dyC < 0.0 || dyC >= f32(uniforms.outBackprop[2]) ||
              fract(dyC) > 0.0) {
            bDyCVal = false;
          }
          if (dyC2 < 0.0 || dyC2 >= f32(uniforms.outBackprop[2]) ||
              fract(dyC2) > 0.0) {
            bDyCVal2 = false;
          }

          let idyC = i32(dyC);
          let idyC2 = i32(dyC2);
          if (bDyCVal && bDyCVal2) {
            let d2Length = uniforms.outBackprop[3];
            for (var d2 = 0; d2 < d2Length; d2 = d2 + 4) {
              let wValue0 = getW(wRPerm, wCPerm, d1, d2);
              let wValue1 = getW(wRPerm, wCPerm, d1 + 1, d2);
              let wValue2 = getW(wRPerm, wCPerm, d1 + 2, d2);
              let wValue3 = getW(wRPerm, wCPerm, d1 + 3, d2);
              var xValue =  getDy(batch, idyR, idyC, d2);
              let tmpval = vec4<f32>(dot(xValue, wValue0),
                                     dot(xValue, wValue1),
                                     dot(xValue, wValue2),
                                     dot(xValue, wValue3));
              dotProd[0] = dotProd[0] + tmpval;
              xValue = getDy(batch, idyR, idyC2, d2);
              dotProd[1] = dotProd[1] + vec4<f32>(dot(xValue, wValue0),
                                                  dot(xValue, wValue1),
                                                  dot(xValue, wValue2),
                                                  dot(xValue, wValue3));
            }
          } else if (bDyCVal) {
            let d2Length = uniforms.outBackprop[3];
            for (var d2 = 0; d2 < d2Length; d2 = d2 + 4) {
              let wValue0 = getW(wRPerm, wCPerm, d1, d2);
              let wValue1 = getW(wRPerm, wCPerm, d1 + 1, d2);
              let wValue2 = getW(wRPerm, wCPerm, d1 + 2, d2);
              let wValue3 = getW(wRPerm, wCPerm, d1 + 3, d2);
              var xValue =  getDy(batch, idyR, idyC, d2);
              let tmpval = vec4<f32>(dot(xValue, wValue0),
                                     dot(xValue, wValue1),
                                     dot(xValue, wValue2),
                                     dot(xValue, wValue3));
              dotProd[0] = dotProd[0] + tmpval;
            }
          } else if (bDyCVal2) {
            let d2Length = uniforms.outBackprop[3];
            for (var d2 = 0; d2 < d2Length; d2 = d2 + 4) {
              let wValue0 = getW(wRPerm, wCPerm, d1, d2);
              let wValue1 = getW(wRPerm, wCPerm, d1 + 1, d2);
              let wValue2 = getW(wRPerm, wCPerm, d1 + 2, d2);
              let wValue3 = getW(wRPerm, wCPerm, d1 + 3, d2);
              var xValue =  getDy(batch, idyR, idyC2, d2);
              let tmpval = vec4<f32>(dot(xValue, wValue0),
                                     dot(xValue, wValue1),
                                     dot(xValue, wValue2),
                                     dot(xValue, wValue3));
              dotProd[1] = dotProd[1] + tmpval;
            }
          }
        }
      }

      for (var i = 0; i < ${this.workPerThread}; i = i + 1) {
        let coords = vec4<i32>(batch, r, c + i, d1);
        if (coordsInBounds4D(coords, uniforms.outShape)) {
          setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], dotProd[i]);
        }
      }
    }
    `;return this.isVec4?`
    ${r}
    `:`
    ${S("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d1 = coords[${i}];

        let dyCorner = vec2<i32>(coords[${e}], coords[${t}]) - uniforms.pads;
        let dyRCorner = dyCorner.x;
        let dyCCorner = dyCorner.y;

        // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var wR = 0; wR < uniforms.filterDims.x; wR = wR + 1) {
          let dyR = (f32(dyRCorner) + f32(wR)) / f32(uniforms.strides.x);
          let wRPerm = uniforms.filterDims.x - 1 - wR;
          if (dyR < 0.0 || dyR >= f32(uniforms.outBackprop[1]) || fract(dyR) > 0.0 ||
              wRPerm < 0) {
            continue;
          }
          let idyR = i32(dyR);

          for (var wC = 0; wC < uniforms.filterDims.y; wC = wC + 1) {
            let dyC = (f32(dyCCorner) + f32(wC)) / f32(uniforms.strides.y);
            let wCPerm = uniforms.filterDims.y - 1 - wC;
            if (dyC < 0.0 || dyC >= f32(uniforms.outBackprop[2]) ||
                fract(dyC) > 0.0 || wCPerm < 0) {
              continue;
            }
            let idyC = i32(dyC);

            for (var d2 = 0; d2 < uniforms.outBackprop[3]; d2 = d2 + 1) {
              let xValue = ${this.isChannelsLast?"getDy(batch, idyR, idyC, d2)":"getDy(batch, d2, idyR, idyC)"};
              let wValue = getW(wRPerm, wCPerm, d1, d2);
              dotProd = dotProd + xValue * wValue;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}class iq{constructor(e){this.variableNames=["x","dy"],this.uniforms="pads : vec2<i32>, strides : vec2<i32>, batchSize : i32, outHeight : i32, outWidth : i32, inHeight : i32, inWidth : i32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.filterShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.isChannelsLast="channelsLast"===e.dataFormat,this.shaderKey=`conv2DDerFilter_${this.isChannelsLast}`}getUserCode(){return`
    ${S("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let wR = coords[0];
        let wC = coords[1];
        let d1 = coords[2];
        let d2 = coords[3];

        // Convolve x(?, ?, d1) with dy(:, :, d2) to get dw(wR, wC, d1, d2).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        for (var b = 0; b < uniforms.batchSize; b = b + 1) {
          for (var yR = 0; yR < uniforms.outHeight; yR = yR + 1) {
            let xR = wR + yR * uniforms.strides[0] - uniforms.pads[0];
            if (xR < 0 || xR >= uniforms.inHeight) {
              continue;
            }

            for (var yC = 0; yC < uniforms.outWidth; yC = yC + 1) {
              let xC = wC + yC * uniforms.strides[1] - uniforms.pads[1];

              if (xC < 0 || xC >= uniforms.inWidth) {
                continue;
              }

              if (${this.isChannelsLast}) {
                let dyValue = getDy(b, yR, yC, d2);
                let xValue = getX(b, xR, xC, d1);
                dotProd = dotProd + xValue * dyValue;
              } else {
                let dyValue = getDy(b, d2, yR, yC);
                let xValue = getX(b, d1, xR, xC);
                dotProd = dotProd + xValue * dyValue;
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}class iY{constructor(e){this.variableNames=["x","dy"],this.uniforms=`pads : vec3<i32>, strides : vec3<i32>, batchSize : i32, outDepth : i32,
       outHeight : i32, outWidth : i32, inDepth : i32, inHeight : i32, inWidth : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.filterShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="conv3DDerFilter"}getUserCode(){return`
    ${S("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let wF = coords.x;
        let wR = coords.y;
        let wC = coords.z;
        let d1 = coords.w;
        let d2 = coords.u;

        var dotProd = 0.0;
        for (var b = 0; b < uniforms.batchSize; b++) {
          for (var yF = 0; yF < uniforms.outDepth; yF++) {
            let xF = wF + yF * uniforms.strides[0] - uniforms.pads[0];
            if (xF < 0 || xF >= uniforms.inDepth) {
              continue;
            }

            for (var yR = 0; yR < uniforms.outHeight; yR++) {
              let xR = wR + yR * uniforms.strides[1] - uniforms.pads[1];
              if (xR < 0 || xR >= uniforms.inHeight) {
                continue;
              }

              for (var yC = 0; yC < uniforms.outWidth; yC++) {
                let xC = wC + yC * uniforms.strides[2] - uniforms.pads[2];
                if (xC < 0 || xC >= uniforms.inWidth) {
                  continue;
                }

                let dyValue = getDy(b, yF, yR, yC, d2);
                let xValue = getX(b, xF, xR, xC, d1);
                dotProd += xValue * dyValue;
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}class ij{constructor(e){this.variableNames=["dy","W"],this.uniforms=`filterDims : vec3<i32>, pads : vec3<i32>, strides : vec3<i32>,
      outDepth : i32, outHeight : i32, outWidth : i32, outChannels : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="conv3DDerInput"}getUserCode(){return`
    ${S("index")} {
      if(index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords.x;
        let d1 = coords.u;

        let dyCorner = vec3<i32>(coords.y, coords.z, coords.w) - uniforms.pads;
        let dyFCorner = dyCorner.x;
        let dyRCorner = dyCorner.y;
        let dyCCorner = dyCorner.z;

        var dotProd = 0.0;
        for (var wF = 0; wF < uniforms.filterDims[0]; wF++) {
          let dyF = f32(dyFCorner + wF) / f32(uniforms.strides[0]);
          if (dyF < 0.0 || dyF >= f32(uniforms.outDepth) || fract(dyF) > 0.0) {
            continue;
          }
          let idyF = i32(dyF);

          let wFPerm = uniforms.filterDims[0] - 1 - wF;

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[1]);

            if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
              continue;
            }
            let idyR = i32(dyR);

            let wRPerm = uniforms.filterDims[1] - 1 - wR;

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[2]);

              if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
                continue;
              }
              let idyC = i32(dyC);

              let wCPerm = uniforms.filterDims[2] - 1 - wC;

              for (var d2 = 0; d2 < uniforms.outChannels; d2++) {
                let xValue = getDy(batch, idyF, idyR, idyC, d2);
                let wValue = getW(wFPerm, wRPerm, wCPerm, d1, d2);
                dotProd += xValue * wValue;
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
  `}}let iQ={kernelName:d.Conv2DBackpropFilter,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,dy:s}=t,{strides:o,pad:n,dataFormat:u,dimRoundingMode:l,filterShape:h}=r,p=d.backend_util.convertConv2DDataFormat(u),c=d.backend_util.computeConv2DInfo(a.shape,h,o,1,n,l,!1,p),f=new iq(c),m=[{type:"int32",data:[c.padInfo.top,c.padInfo.left]},{type:"int32",data:[c.strideHeight,c.strideWidth]},{type:"int32",data:[c.batchSize]},{type:"int32",data:[c.outHeight]},{type:"int32",data:[c.outWidth]},{type:"int32",data:[c.inHeight]},{type:"int32",data:[c.inWidth]}];return i.runWebGPUProgram(f,[a,s],a.dtype,m)}};class iZ{constructor(e){this.variableNames=["x","W"],this.uniforms="filterDims : vec2<i32>, pads : vec2<i32>, strides : vec2<i32>, outBackprop : vec4<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32,",this.outputShape=e.inShape,d.util.assert("channelsLast"===e.dataFormat,()=>"TODO: NCHW is unimplemented"),this.isVec4=e.inChannels%4==0&&e.outChannels%4==0,this.dispatchLayout={x:[3],y:[1,2],z:[0]},this.workgroupSize=_(this.dispatchLayout,this.outputShape,this.isVec4),this.elementsPerThread=T(this.dispatchLayout,this.outputShape,this.isVec4),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,this.elementsPerThread),this.isVec4&&(this.outputComponent=4,this.variableComponents=[4,1]),this.shaderKey=`conv2DDerInputMM_${this.isVec4}_${this.elementsPerThread}`}getUserCode(){let e=this.isVec4?ez(this.elementsPerThread,this.workgroupSize):eD(this.elementsPerThread,this.workgroupSize);return`
    ${function(e=4){let t=`
      let outRow = row / uniforms.outShape[2];
      let outCol = row % uniforms.outShape[2];

      let WRow = col / (uniforms.filterDims[1] * uniforms.outBackprop[3]);
      let WCol = col / uniforms.outBackprop[3] % uniforms.filterDims[1];
      let xR = f32(outRow - uniforms.pads[0] + WRow) / f32(uniforms.strides[0]);
      let xC = f32(outCol - uniforms.pads[1] + WCol) / f32(uniforms.strides[1]);
      if (xR < 0.0 || xR >= f32(uniforms.outBackprop[1]) || fract(xR) > 0.0) {
        return ${w(e)}(0.0);
      }
      if (xC < 0.0 || xC >= f32(uniforms.outBackprop[2]) || fract(xC) > 0.0) {
        return ${w(e)}(0.0);
      }
      let coord = vec4<i32>(
          batch,
          i32(xR),
          i32(xC),
          col % uniforms.outBackprop[3]);
      return x[getIndexFromCoords4D(coord, uniforms.xShape)/${e}];`,i=`if (row < uniforms.dimAOuter && col < uniforms.dimInner) {
        ${t}
      }
      return ${w(e)}(0.0);`;return`
  fn mm_readA(batch: i32, row : i32, col : i32) -> ${w(e)} {
    ${i}
  }

  fn mm_readB(batch: i32, row : i32, col : i32) -> ${w(e)} {
    let coordX = uniforms.filterDims.x - 1 -
        row / (uniforms.filterDims[1] * uniforms.outBackprop[3]);
    let coordY = uniforms.filterDims.y - 1 -
        (row / uniforms.outBackprop[3]) % uniforms.filterDims[1];
    if (row < uniforms.dimInner && col < uniforms.dimBOuter &&
        coordX >= 0 && coordY >= 0) {
      let rowInner = row % uniforms.outBackprop[3];
      let coord = vec4<i32>(coordX, coordY, col, rowInner);
      ${(e=>{switch(e){case 1:return"return W[getIndexFromCoords4D(coord, uniforms.wShape)];";case 4:return`
            let coord1 = vec4<i32>(coordX, coordY, col + 1, rowInner);
            let coord2 = vec4<i32>(coordX, coordY, col + 2, rowInner);
            let coord3 = vec4<i32>(coordX, coordY, col + 3, rowInner);
            let v0 = W[getIndexFromCoords4D(coord, uniforms.wShape)];
            let v1 = W[getIndexFromCoords4D(coord1, uniforms.wShape)];
            let v2 = W[getIndexFromCoords4D(coord2, uniforms.wShape)];
            let v3 = W[getIndexFromCoords4D(coord3, uniforms.wShape)];
            return vec4<f32>(v0, v1, v2, v3);
            `;default:throw Error(`innerElementSize ${e} is not supported.`)}})(e)}
    }
    return ${w(e)}(0.0);
  }

  fn mm_write(batch: i32, row : i32, col : i32, valueInput : ${w(e)}) {
    if (row < uniforms.dimAOuter && col < uniforms.dimBOuter) {
      var value = valueInput;
      let outCoord = vec4<i32>(
          batch,
          row / uniforms.outShape[2],
          row % uniforms.outShape[2],
          col);
      result[getIndexFromCoords4D(outCoord, uniforms.outShape)/${e}] = value;
    }
  }`}(this.isVec4?4:1)}
    ${e}
    `}}let iJ={kernelName:d.Conv2DBackpropInput,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{dy:s,filter:o}=i,{inputShape:n,strides:u,pad:l,dataFormat:h,dimRoundingMode:p}=a,c=d.backend_util.convertConv2DDataFormat(h),f=d.backend_util.computeConv2DInfo(n,o.shape,u,1,l,p,!1,c),m=[{type:"int32",data:[f.filterHeight,f.filterWidth]},{type:"int32",data:[f.filterHeight-1-f.padInfo.top,f.filterWidth-1-f.padInfo.left]},{type:"int32",data:[f.strideHeight,f.strideWidth]},{type:"int32",data:[f.batchSize,f.outHeight,f.outWidth,f.outChannels]}];if((0,d.env)().getBool("WEBGPU_USE_NAIVE_CONV2D_TRANSPOSE")||"channelsLast"!==f.dataFormat)t=new iK(f);else{t=new iZ(f);let e=f.inHeight*f.inWidth,i=f.inChannels,r=f.filterHeight*f.filterWidth*f.outChannels;m.push({type:"uint32",data:[e]},{type:"uint32",data:[i]},{type:"uint32",data:[r]})}return r.runWebGPUProgram(t,[s,o],"float32",m)}};class i2{constructor(e){this.variableNames=["x","W"],this.uniforms="filterDims: vec3<i32>, pads: vec3<i32>, strides: vec3<i32>, dilations: vec3<i32>,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="conv3dnaive"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let batch = coords.x;
        let d2 = coords.u;

        let xFRCCorner = vec3<i32>(coords.y, coords.z, coords.w) * uniforms.strides - uniforms.pads;
        let xFCorner = xFRCCorner.x;
        let xRCorner = xFRCCorner.y;
        let xCCorner = xFRCCorner.z;

        let inputDepthNearestVec4 = (uniforms.xShape.u / 4) * 4;
        let inputDepthVec4Remainder = uniforms.xShape.u % 4;

        var dotProd = 0.0;
        for (var wF = 0; wF < uniforms.filterDims[0]; wF++) {
          let xF = xFCorner + wF * uniforms.dilations[0];
          if (xF < 0 || xF >= uniforms.xShape.y) {
            continue;
          }

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let xR = xRCorner + wR * uniforms.dilations[1];
            if (xR < 0 || xR >= uniforms.xShape.z) {
              continue;
            }

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let xC = xCCorner + wC * uniforms.dilations[2];
              if (xC < 0 || xC >= uniforms.xShape.w) {
                continue;
              }

              for (var d1 = 0; d1 < inputDepthNearestVec4; d1 += 4) {
                let xValues = vec4<f32>(
                  getX(batch, xF, xR, xC, d1),
                  getX(batch, xF, xR, xC, d1 + 1),
                  getX(batch, xF, xR, xC, d1 + 2),
                  getX(batch, xF, xR, xC, d1 + 3)
                );
                let wValues = vec4<f32>(
                  getW(wF, wR, wC, d1, d2),
                  getW(wF, wR, wC, d1 + 1, d2),
                  getW(wF, wR, wC, d1 + 2, d2),
                  getW(wF, wR, wC, d1 + 3, d2)
                );

                dotProd += dot(xValues, wValues);
              }

              if (inputDepthVec4Remainder == 1) {
                dotProd += getX(batch, xF, xR, xC, inputDepthNearestVec4) *
                  getW(wF, wR, wC, inputDepthNearestVec4, d2);
              } else if (inputDepthVec4Remainder == 2) {
                let xValues = vec2<f32>(
                  getX(batch, xF, xR, xC, inputDepthNearestVec4),
                  getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1)
                );
                let wValues = vec2<f32>(
                  getW(wF, wR, wC, inputDepthNearestVec4, d2),
                  getW(wF, wR, wC, inputDepthNearestVec4 + 1, d2)
                );
                dotProd += dot(xValues, wValues);
              } else if (inputDepthVec4Remainder == 3) {
                let xValues = vec3<f32>(
                  getX(batch, xF, xR, xC, inputDepthNearestVec4),
                  getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1),
                  getX(batch, xF, xR, xC, inputDepthNearestVec4 + 2)
                );
                let wValues = vec3<f32>(
                  getW(wF, wR, wC, inputDepthNearestVec4, d2),
                  getW(wF, wR, wC, inputDepthNearestVec4 + 1, d2),
                  getW(wF, wR, wC, inputDepthNearestVec4 + 2, d2)
                );
                dotProd += dot(xValues, wValues);
              }
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }`}}let i3={kernelName:d.Conv3D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s}=t,{strides:o,pad:n,dilations:u}=r,l=d.backend_util.computeConv3DInfo(a.shape,s.shape,o,u,n),h=[l.padInfo.front,l.padInfo.top,l.padInfo.left],p=[{type:"int32",data:[l.filterDepth,l.filterHeight,l.filterWidth]},{type:"int32",data:[...h]},{type:"int32",data:[l.strideDepth,l.strideHeight,l.strideWidth]},{type:"int32",data:[l.dilationDepth,l.dilationHeight,l.dilationWidth]}],c=new i2(l),f=(0,d.upcastType)(a.dtype,s.dtype);return i.runWebGPUProgram(c,[a,s],f,p)}},i0={kernelName:d.Conv3DBackpropFilterV2,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,dy:s}=t,{strides:o,pad:n,filterShape:u}=r,l=d.backend_util.computeConv3DInfo(a.shape,u,o,1,n),h=new iY(l),p=[{type:"int32",data:[l.padInfo.front,l.padInfo.top,l.padInfo.left]},{type:"int32",data:[l.strideDepth,l.strideHeight,l.strideWidth]},{type:"int32",data:[l.batchSize]},{type:"int32",data:[l.outDepth]},{type:"int32",data:[l.outHeight]},{type:"int32",data:[l.outWidth]},{type:"int32",data:[l.inDepth]},{type:"int32",data:[l.inHeight]},{type:"int32",data:[l.inWidth]}];return i.runWebGPUProgram(h,[a,s],s.dtype,p)}},i1={kernelName:d.Conv3DBackpropInputV2,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,filter:s}=t,{strides:o,pad:n,inputShape:u}=r,l=d.backend_util.computeConv3DInfo(u,s.shape,o,1,n),h=new ij(l),p=[{type:"int32",data:[l.filterDepth,l.filterHeight,l.filterWidth]},{type:"int32",data:[l.filterDepth-1-l.padInfo.front,l.filterHeight-1-l.padInfo.top,l.filterWidth-1-l.padInfo.left]},{type:"int32",data:[l.strideDepth,l.strideHeight,l.strideWidth]},{type:"int32",data:[l.outDepth]},{type:"int32",data:[l.outHeight]},{type:"int32",data:[l.outWidth]},{type:"int32",data:[l.outChannels]}];return i.runWebGPUProgram(h,[a,s],a.dtype,p)}},i4=eJ({opType:n.COS}),i6={kernelName:d.Cos,backendName:"webgpu",kernelFunc:i4},i5=eJ({opType:n.COSH}),i8={kernelName:d.Cosh,backendName:"webgpu",kernelFunc:i5};class i9{constructor(e,t,i,r){this.variableNames=["Image","Boxes","BoxInd"],this.uniforms="extrapolationValue : f32,",this.workgroupSize=[64,1,1],this.size=!0;let[a]=t;this.outputShape=[a,i[0],i[1],e],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.methodId="bilinear"===r?1:0,this.cropHeightBiggerThan1=this.outputShape[1]>1,this.cropWidthBiggerThan1=this.outputShape[2]>1,this.shaderKey=`cropAndResize_${this.methodId}_${this.cropHeightBiggerThan1}_${this.cropWidthBiggerThan1}`}getUserCode(){let[e,t]=["f32(uniforms.imageShape[1] - 1)","f32(uniforms.imageShape[2] - 1)"],[i,r,a]=this.cropHeightBiggerThan1?[`(${e} / f32(uniforms.outShape[1] - 1))`,"(y2-y1) * height_ratio",`y1*${e} + f32(y)*(height_scale)`]:["0.0","0.0",`0.5 * (y1+y2) * ${e}`],[s,o,n]=this.cropWidthBiggerThan1?[`(${t} / f32(uniforms.outShape[2] - 1))`,"(x2-x1) * width_ratio",`x1*${t} + f32(x)*(width_scale)`]:["0.0","0.0",`0.5 * (x1+x2) * ${t}`];return`
    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let height_ratio = f32(${i});
        let width_ratio = f32(${s});
        let b = coords[0];
        let y = coords[1];
        let x = coords[2];
        let d = coords[3];
        // get box vals
        let y1 = getBoxes(b, 0);
        let x1 = getBoxes(b, 1);
        let y2 = getBoxes(b, 2);
        let x2 = getBoxes(b, 3);
        // get image in batch index
        let bInd = i32(round(getBoxInd(b)));
        if(bInd < 0 || bInd >= uniforms.outShape[0]) {
          return;
        }
        let height_scale = ${r};
        let width_scale = ${o};
        let in_y = ${a};
        if( in_y < 0.0 || in_y > ${e} ) {
          setOutputAtIndex(index, uniforms.extrapolationValue);
          return;
        }
        let in_x = ${n};
        if( in_x < 0.0 || in_x > ${t} ) {
          setOutputAtIndex(index, uniforms.extrapolationValue);
          return;
        }
        let sourceFracIndexCR = vec2<f32>(in_x,in_y);
        if(${this.methodId} == 1) {
          // Compute the four integer indices.
          let sourceFloorCR = vec2<i32>(sourceFracIndexCR);
          let sourceCeilCR = vec2<i32>(ceil(sourceFracIndexCR));
          let topLeft = getImage(bInd, sourceFloorCR.y, sourceFloorCR.x, d);
          let bottomLeft = getImage(bInd, sourceCeilCR.y, sourceFloorCR.x, d);
          let topRight = getImage(bInd, sourceFloorCR.y, sourceCeilCR.x, d);
          let bottomRight = getImage(bInd, sourceCeilCR.y, sourceCeilCR.x, d);
          let fracCR = sourceFracIndexCR - vec2<f32>(sourceFloorCR);
          let top = topLeft + (topRight - topLeft) * fracCR.x;
          let bottom = bottomLeft + (bottomRight - bottomLeft) * fracCR.x;
          let newValue = top + (bottom - top) * fracCR.y;
          setOutputAtIndex(index, newValue);
        } else {
          // Compute the coordinators of nearest neighbor point.
          let sourceNearestCR = vec2<i32>(floor(
            sourceFracIndexCR + vec2<f32>(0.5,0.5)));
          let newValue = getImage(
            bInd, sourceNearestCR.y, sourceNearestCR.x, d);
          setOutputAtIndex(index, newValue);
        }
      }
    }
    `}}let i7={kernelName:d.CropAndResize,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{image:a,boxes:s,boxInd:o}=t,{cropSize:n,method:u,extrapolationValue:l}=r,d=new i9(a.shape[3],s.shape,n,u);return i.runWebGPUProgram(d,[a,s,o],"float32",[{type:"float32",data:[l]}])}};!function(e){e.Prod="*",e.Sum="+"}(u||(u={}));class re{constructor(e,t,i,r){this.variableNames=["x"],this.uniforms="index : f32,",this.size=!0,this.workgroupSize=[128,1,1],this.outputShape=t,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.exclusive=i,this.reverse=r,this.op=e,this.shaderKey=`cum_${this.op}_${this.exclusive}_${this.reverse}`}getUserCode(){let e=this.outputShape.length,t=this.op===u.Prod?"1.0":"0.0",i=this.exclusive?t:`getX(${rt(e,"coords",this.op)})`,r=this.outputShape[this.outputShape.length-1],a="",s="";return this.exclusive?(a=this.reverse?`end != ${r-1}`:"end != 0",s=this.reverse?"end + 1":"end - 1"):(a=this.reverse?`end + pow2 < ${r}`:"end >= pow2",s=this.reverse?"end + pow2":"end - pow2"),`
      ${S("index")} {
       if (index < uniforms.size) {
         var coords = getCoordsFromIndex(index);

         let end = ${ri(e,"coords",this.op)};
         var val = ${i};
         let pow2 = i32(pow(2.0, uniforms.index));
         if (${a}) {
           let idx = ${s};
           ${ri(e,"coords",this.op)} = idx;
           val ${this.op}= getX(${rt(e,"coords",this.op)});
         }
         setOutputAtIndex(index, val);
       }
      }
    `}}function rt(e,t,i){if(1===e)return`${t}`;if(2===e)return`${t}.x, ${t}.y`;if(3===e)return`${t}.x, ${t}.y, ${t}.z`;if(4===e)return`${t}.x, ${t}.y, ${t}.z, ${t}.w`;throw Error(`Cumulative ${i} for rank ${e} is not yet supported`)}function ri(e,t,i){if(1===e)return`${t}`;if(2===e)return`${t}.y`;if(3===e)return`${t}.z`;if(4===e)return`${t}.w`;throw Error(`Cumulative ${i} for rank ${e} is not yet supported`)}function rr(e,t,i,r,a,s){let o=t.shape.length,n=d.backend_util.getAxesPermutation([r],o),u=t;null!=n&&(u=tW({inputs:{x:t},backend:i,attrs:{perm:n}}));let l=d.backend_util.getInnerMostAxes(1,o)[0];if(l!==o-1)throw Error(`WebGPU cumprod shader expects an inner-most axis=${t.shape.length-1} but got axis=${r}`);let h=u.shape[l],p=eq({inputs:{x:u},backend:i});for(let t=0;t<=Math.ceil(Math.log2(h))-1;t++){let r=new re(e,u.shape,!1,s),a=p,o=[{type:"float32",data:[t]}];p=i.runWebGPUProgram(r,[p],p.dtype,o),i.disposeData(a.dataId)}if(a){let t=new re(e,u.shape,a,s),r=p;p=i.runWebGPUProgram(t,[p],p.dtype,[{type:"float32",data:[0]}]),i.disposeData(r.dataId)}if(null!=n){let e=tW({inputs:{x:p},backend:i,attrs:{perm:d.backend_util.getUndoAxesPermutation(n)}});return i.disposeData(p.dataId),i.disposeData(u.dataId),e}return p}let ra={kernelName:d.Cumprod,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,exclusive:o,reverse:n}=r;return rr(u.Prod,a,i,s,o,n)}},rs={kernelName:d.Cumsum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,exclusive:o,reverse:n}=r;return rr(u.Sum,a,i,s,o,n)}},ro={kernelName:d.DenseBincount,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,weights:s}=t,{size:o,binaryOutput:n}=r,u=1===a.shape.length,l=d.util.sizeFromShape(s.shape)>0,h=s.dtype,p=u?[a.shape[0]]:[a.shape[0],a.shape[1]],c=eO({backend:i,attrs:{shape:u?[o]:[a.shape[0],o],value:0,dtype:h}}),f=new iw(p,l,n),m=[{type:"int32",data:[o]}],g=l?[a,s]:[a];return i.runWebGPUProgram(f,g,h,m,c)}};class rn{constructor(e,t){this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.uniforms="blockSize : i32,",this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey=`depthToSpace_${t}`,this.dataFormat=t}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let b = coords[0];
          let h = ${this.getHeightCoordString()};
          let w = ${this.getWidthCoordString()};
          let d = ${this.getDepthCoordString()};

          let in_h = h / uniforms.blockSize;
          let offset_h = h % uniforms.blockSize;
          let in_w = w / uniforms.blockSize;
          let offset_w = w % uniforms.blockSize;
          let offset_d = (offset_h * uniforms.blockSize + offset_w) *
            ${this.getOutputDepthSize()};
          let in_d = d + offset_d;

          let rlt = ${this.getInputSamplingString()};
          setOutputAtIndex(index, rlt);
        }
      }`}getHeightCoordString(){return"NHWC"===this.dataFormat?"coords[1]":"coords[2]"}getWidthCoordString(){return"NHWC"===this.dataFormat?"coords[2]":"coords[3]"}getDepthCoordString(){return"NHWC"===this.dataFormat?"coords[3]":"coords[1]"}getOutputDepthSize(){return"NHWC"===this.dataFormat?"uniforms.outShape[3]":"uniforms.outShape[1]"}getInputSamplingString(){return"NHWC"===this.dataFormat?"getX(b, in_h, in_w, in_d)":"getX(b, in_d, in_h, in_w)"}}let ru={kernelName:d.DepthToSpace,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{blockSize:s,dataFormat:o}=r,n=a.shape[0],u="NHWC"===o?a.shape[1]:a.shape[2],l="NHWC"===o?a.shape[2]:a.shape[3],d="NHWC"===o?a.shape[3]:a.shape[1],h=u*s,p=l*s,c=d/(s*s),f=new rn("NHWC"===o?[n,h,p,c]:[n,c,h,p],o);return i.runWebGPUProgram(f,[a],a.dtype,[{type:"int32",data:[s]}])}};class rl{constructor(e,t,i,r=!1,a=null,s=!1){this.variableNames=["x","W"],this.uniforms="pads : vec2<i32>, inDims : vec2<i32>,",this.workgroupSize=[16,16,1],this.outputShape=e,this.dispatchLayout={x:[3],y:[2],z:[0,1]},this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),r&&this.variableNames.push("bias"),s&&this.variableNames.push("preluActivationWeights"),this.addBias=r,this.activation=a,this.hasPreluActivation=s,this.filterHeight=t,this.filterWidth=i,this.shaderKey=`depthwiseNCHW_${this.activation}_${this.filterHeight}_${this.filterWidth}`}getUserCode(){let e=this.filterWidth*this.filterHeight,t=this.workgroupSize[0]*this.workgroupSize[1]*this.workgroupSize[2],i=this.workgroupSize[1]+this.filterHeight-1,r=this.workgroupSize[0]+this.filterWidth-1;return`
      ${ev(this.activation,this.hasPreluActivation,!1,4)}

      var<workgroup> mm_Asub : array<array<f32, ${r}>, ${i}>;
      var<workgroup> mm_Bsub : array<array<f32, ${this.filterWidth}>, ${this.filterHeight}>;
      fn readX(batch : i32, channel : i32, row : i32, col : i32) -> f32 {
        var value = 0.0;
        if (row >=0 && row < uniforms.inDims[0] && col >=0 && col < uniforms.inDims[1])
        {
          value = getX(batch, channel, row, col);
        }
        return value;
      }

      ${S()} {
        let coords = getOutputCoords();
        let batch = coords[0];
        let xRCCorner = vec2<i32>(coords.zw) - uniforms.pads;
        let channelMul = uniforms.wShape[3];
        let d1 = coords[1] / channelMul;
        let q = coords[1] % channelMul;

        let inputRowStart = xRCCorner.x;
        let inputColStart = xRCCorner.y;

        let localRow = i32(localId.y);
        let localCol = i32(localId.x);

        // Load one tile of X into local memory.
        for (var inputRow = localRow; inputRow < ${i}; inputRow = inputRow + ${this.workgroupSize[1]}) {
          for (var inputCol = localCol; inputCol < ${r}; inputCol = inputCol + ${this.workgroupSize[0]}) {
            let rowOffset = inputRow - localRow;
            let colOffset = inputCol - localCol;
            mm_Asub[inputRow][inputCol] = readX(batch, d1, inputRowStart + rowOffset, inputColStart + colOffset);
          }
        }

        // Load one tile of W into local memory.
        var wIndex = i32(localIndex);
        ${e<t?`if (wIndex < ${e})`:`for(; wIndex < ${e}; wIndex = wIndex + ${t})`}

        {
          let wRow = wIndex / ${this.filterWidth};
          let wCol = wIndex % ${this.filterWidth};
          mm_Bsub[wRow][wCol] = getW(wRow, wCol, d1, q);
        }

        workgroupBarrier();

        var value = 0.0;
        for (var wR = 0; wR < ${this.filterHeight}; wR = wR + 1) {
          for (var wC = 0; wC < ${this.filterWidth}; wC = wC + 1) {
            let xVal = mm_Asub[localRow + wR][localCol + wC];
            let wVal = mm_Bsub[wR][wC];
            value = fma(xVal, wVal, value);
          }
        }
        ${eI(this.addBias,this.activation)}
        if (coordsInBounds4D(coords, uniforms.outShape)) {
          setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
        }
      }
    `}}class rd{constructor(e,t=!1,i=null,r=!1){this.variableNames=["x","W"],this.uniforms="pads : vec2<i32>, inDims : vec2<i32>, virtualWidth : i32,",this.workgroupSize=[64,1,1],this.workPerThread=4,this.outputComponent=4,this.outputShape=e.outShape,this.virtualWidth=Math.ceil(this.outputShape[2]/this.workPerThread)*this.workPerThread;let a=[this.outputShape[0],this.outputShape[1],this.virtualWidth,this.outputShape[3]];this.dispatchLayout=L(a),this.dispatch=D(this.dispatchLayout,a,this.workgroupSize,[this.outputComponent*this.workPerThread,1,1]),d.util.assert("channelsLast"===e.dataFormat,()=>"TODO: NCHW is unimplemented"),t&&this.variableNames.push("bias"),r&&this.variableNames.push("preluActivationWeights"),this.convInfo=e,this.addBias=t,this.activation=i,this.hasPreluActivation=r,this.shaderKey=`depthwiseVec4_${i}_${this.convInfo.filterHeight}_${this.convInfo.filterWidth}_${this.convInfo.strideHeight}_${this.convInfo.strideWidth}_${this.workPerThread}`}getUserCode(){let e=(this.workPerThread-1)*this.convInfo.strideWidth+this.convInfo.filterWidth,t=this.convInfo.strideHeight,i=this.convInfo.strideWidth;return`
      ${ev(this.activation,this.hasPreluActivation,!0,4)}
      fn readX(batch : i32, row : i32, col : i32, channel : i32) -> vec4<f32> {
        var value = vec4<f32>(0.0);
        if (col >=0 && col < uniforms.inDims[1]) {
          value = getX(batch, row, col, channel);
        }
        return value;
      }

      ${S("index")} {
        let width0 = uniforms.outShape[3] / ${this.outputComponent};
        let d1 = (index % width0) * ${this.outputComponent};
        var index1 = index / width0;
        let width1 = uniforms.virtualWidth / ${this.workPerThread};
        let c = (index1 % width1) * ${this.workPerThread};
        index1 = index1 / width1;
        let r = index1 % uniforms.outShape[1];
        let batch = index1 / uniforms.outShape[1];

        let xRCCorner = vec2<i32>(r, c) * vec2<i32>(${t}, ${i}) - uniforms.pads;

        let xRCorner = xRCCorner.x;
        let xCCorner = xRCCorner.y;
        var xVals : array<vec4<f32>, ${e}>;
        var dotProd : array<vec4<f32>, ${this.workPerThread}>;
        for (var i = 0; i < ${this.workPerThread}; i++) {
          dotProd[i] = vec4<f32>(0.0);
        }

        // Use constant instead of uniform can give better performance.
        for (var wR = 0; wR < ${this.convInfo.filterHeight}; wR = wR + 1) {
          let xR = xRCorner + wR;
          if (xR >=0 && xR < uniforms.inDims[0]) {
            for (var i = 0; i < ${e}; i++) {
              xVals[i] = readX(batch, xR, xCCorner + i, d1);
            }
            for (var wC = 0; wC < ${this.convInfo.filterWidth}; wC = wC + 1) {
              let wValue = getW(wR, wC, d1, 0);
              for (var i = 0; i < ${this.workPerThread}; i++) {
                dotProd[i] = fma(xVals[i * ${i} + wC], wValue, dotProd[i]);
              }
            }
          }
        }

        for (var i = 0; i < ${this.workPerThread}; i = i + 1) {
          let coords = vec4<i32>(batch, r, c + i, d1);
          if (coordsInBounds4D(coords, uniforms.outShape)) {
            var value = dotProd[i];
            ${eI(this.addBias,this.activation)}
            setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
          }
        }
      }
    `}}class rh{constructor(e,t=!1,i=null,r=!1){this.variableNames=["x","W"],this.uniforms=`pads : vec2<i32>, inDims : vec2<i32>, filterHeight : i32,
      filterWidth : i32, strides : vec2<i32>, dilations : vec2<i32>,`,this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.isChannelsLast="channelsLast"===e.dataFormat,t&&this.variableNames.push("bias"),r&&this.variableNames.push("preluActivationWeights"),this.convInfo=e,this.addBias=t,this.activation=i,this.hasPreluActivation=r,this.shaderKey=`depthwise_${this.activation}_${this.isChannelsLast}`}getUserCode(){let e=this.isChannelsLast?"getX(batch, xR, xC, d1);":"getX(batch, d1, xR, xC);";return`
      ${ev(this.activation,this.hasPreluActivation,!1,4)}

      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let batch = coords[0];
          let xRCCorner = vec2<i32>(coords.${this.isChannelsLast?"yz":"zw"}) * uniforms.strides - uniforms.pads;
          let d2 = coords[${this.isChannelsLast?3:1}];
          let channelMul = uniforms.wShape[3];
          let d1 = d2 / channelMul;
          let q = d2 % channelMul;

          let inputRowStart = xRCCorner.x;
          let inputColStart = xRCCorner.y;
          let inputRowEnd = inputRowStart + uniforms.filterHeight *
              uniforms.dilations[0];
          let inputColEnd = inputColStart + uniforms.filterWidth *
              uniforms.dilations[1];

          // Convolve x(?, ?, d1)|x(d1, ?, ?) with w(:, :, d1, q) to get
          // y(yR, yC, d2)|y(d2, yR, yC). ? = to be determined. : = across all
          // values in that axis. x(?, ?, d1) and y(yR, yC, d2) is for NHWC.
          // x(d1, ?, ?) and y(d2, yR, yC) is for NCHW.
          var value = 0.0;

          // Extract if checking out of for loop for performance.
          if (inputRowStart >= 0 && inputColStart >= 0 &&
            inputRowEnd < uniforms.inDims[0] &&
                inputColEnd < uniforms.inDims[1]) {
              for (var wR = 0; wR < uniforms.filterHeight; wR = wR + 1) {
                let xR = inputRowStart + wR * uniforms.dilations[0];

                for (var wC = 0; wC < uniforms.filterWidth; wC = wC + 1) {
                  let xC = inputColStart + wC * uniforms.dilations[1];

                  let xVal = ${e};
                  let wVal = getW(wR, wC, d1, q);
                  value = value + xVal * wVal;
                }
              }
            } else {
              for (var wR = 0; wR < uniforms.filterHeight; wR = wR + 1) {
                let xR = inputRowStart + wR * uniforms.dilations[0];

                if (xR < 0 || xR >= uniforms.inDims[0]) {
                  continue;
                }

                for (var wC = 0; wC < uniforms.filterWidth; wC = wC + 1) {
                  let xC = inputColStart + wC * uniforms.dilations[1];

                  if (xC < 0 || xC >= uniforms.inDims[1]) {
                    continue;
                  }

                  let xVal = ${e};
                  let wVal = getW(wR, wC, d1, q);
                  value = value + xVal * wVal;
                }
              }
            }
            ${eI(this.addBias,this.activation)}
          setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
        }
      }
    `}}let rp={kernelName:d.DepthwiseConv2dNative,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s,filter:o}=i,{strides:n,pad:u,dataFormat:l,dilations:h,dimRoundingMode:p}=a,c=d.backend_util.convertConv2DDataFormat(l),f=h;null==f&&(f=[1,1]);let m=d.backend_util.computeConv2DInfo(s.shape,o.shape,n,f,u,p,!0,c),g=[{type:"int32",data:[m.padInfo.top,m.padInfo.left]},{type:"int32",data:[m.inHeight,m.inWidth]}],x="channelsLast"===m.dataFormat;return!x&&m.inHeight>16&&m.inWidth>16&&1===m.strideHeight&&1===m.strideWidth&&1===m.dilationWidth&&1===m.dilationHeight&&m.inChannels===m.outChannels?t=new rl(m.outShape,m.filterHeight,m.filterWidth):x&&m.outHeight>4&&m.outWidth>4&&m.strideWidth<=2&&m.inChannels===m.outChannels&&1===m.dilationHeight&&1===m.dilationWidth&&m.inChannels%4==0?(t=new rd(m),g.push({type:"int32",data:[t.virtualWidth]})):(t=new rh(m),g.push({type:"int32",data:[m.filterHeight]},{type:"int32",data:[m.filterWidth]},{type:"int32",data:[m.strideHeight,m.strideWidth]},{type:"int32",data:[m.dilationHeight,m.dilationWidth]})),r.runWebGPUProgram(t,[s,o],s.dtype,g)}};class rc{constructor(e){this.variableNames=["x","dy"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, filterDims : vec2<i32>, outHeight : i32,
      outWidth : i32, inHeight : i32, inWidth : i32, batchSize : i32, channelMul : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.filterShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="depthwise_conv2d_backprop_filter"}getUserCode(){return`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let wR = coords[0];
        let wC = coords[1];
        let d1 = coords[2];
        let dm = coords[3];
        let d2 = d1 * uniforms.channelMul + dm;

        var dotProd = 0.0;
        for (var b = 0; b < uniforms.batchSize; b++) {
          for (var yR = 0; yR < uniforms.outHeight; yR++) {
            let xR = wR + yR * uniforms.strides[0] - uniforms.pads[0];

            if (xR < 0 || xR >= uniforms.inHeight) {
              continue;
            }

            for (var yC = 0; yC < uniforms.outWidth; yC++) {
              let xC = wC + yC * uniforms.strides[1] - uniforms.pads[1];

              if (xC < 0 || xC >= uniforms.inWidth) {
                continue;
              }

              let dyValue = getDy(b, yR, yC, d2);
              let xValue = getX(b, xR, xC, d1);
              dotProd += xValue * dyValue;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}class rf{constructor(e){this.variableNames=["dy","W"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, filterDims : vec2<i32>,
       outHeight : i32, outWidth : i32, channelMul : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="depthwise_conv2d_backprop_input"}getUserCode(){return`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d1 = coords[3];
        let dyCorner = coords.yz - uniforms.pads;
        let dyRCorner = dyCorner.x;
        let dyCCorner = dyCorner.y;

        var dotProd = 0.0;
        for (var wR = 0; wR < uniforms.filterDims[0]; wR++) {
          let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[0]);

          if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
            continue;
          }

          let idyR = i32(dyR);
          let wRPerm = uniforms.filterDims[0] - 1 - wR;

          for (var wC = 0; wC < uniforms.filterDims[1]; wC++) {
            let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[1]);

            if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
              continue;
            }

            let idyC = i32(dyC);
            let wCPerm = uniforms.filterDims[1] - 1 - wC;

            for (var dm = 0; dm < uniforms.channelMul; dm++) {
              let d2 = d1 * uniforms.channelMul + dm;
              let xValue = getDy(batch, idyR, idyC, d2);
              let wValue = getW(wRPerm, wCPerm, d1, dm);
              dotProd += xValue * wValue;
            }
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}let rm={kernelName:d.DepthwiseConv2dNativeBackpropFilter,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,dy:s}=t,{strides:o,dilations:n,pad:u,dimRoundingMode:l,filterShape:h}=r,p=d.backend_util.computeConv2DInfo(a.shape,h,o,n,u,l,!0),c=new rc(p),f=[{type:"int32",data:[p.strideHeight,p.strideWidth]},{type:"int32",data:[p.padInfo.top,p.padInfo.left]},{type:"int32",data:[p.filterHeight,p.filterWidth]},{type:"int32",data:[p.outHeight]},{type:"int32",data:[p.outWidth]},{type:"int32",data:[p.inHeight]},{type:"int32",data:[p.inWidth]},{type:"int32",data:[p.batchSize]},{type:"int32",data:[p.outChannels/p.inChannels]}];return i.runWebGPUProgram(c,[a,s],"float32",f)}},rg={kernelName:d.DepthwiseConv2dNativeBackpropInput,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,filter:s}=t,{strides:o,dilations:n,pad:u,dimRoundingMode:l,inputShape:h}=r,p=d.backend_util.computeConv2DInfo(h,s.shape,o,n,u,l,!0),c=new rf(p),f=[{type:"int32",data:[p.strideHeight,p.strideWidth]},{type:"int32",data:[p.filterHeight-1-p.padInfo.top,p.filterWidth-1-p.padInfo.left]},{type:"int32",data:[p.filterHeight,p.filterWidth]},{type:"int32",data:[p.outHeight]},{type:"int32",data:[p.outWidth]},{type:"int32",data:[p.outChannels/p.inChannels]}];return i.runWebGPUProgram(c,[a,s],a.dtype,f)}};class rx{constructor(e){this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e,e],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="diag"}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let value = select(0.0, getX(coords[0]), coords[0] == coords[1]);
          setOutputAtIndex(index, value);
        }
      }
    `}}let ry={kernelName:d.Diag,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r}=t,a=[...r.shape,...r.shape],s=d.util.sizeFromShape(r.shape),o=eV({inputs:{x:r},backend:i,attrs:{shape:[s]}}),n=new rx(s),u=i.runWebGPUProgram(n,[o],o.dtype),l=eV({inputs:{x:u},backend:i,attrs:{shape:a}});return i.disposeData(o.dataId),i.disposeData(u.dataId),l}};class rw{constructor(e){this.variableNames=["x","w"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.outShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="dilation2d"}getUserCode(){return`
       ${S("index")} {
         if (index < uniforms.size) {
           let neg_infinity = -3.4e38;
           let coords = getOutputCoords();
           let batch = coords.x;
           let d1 = coords.w;
           let outTopLeftCorner = coords.yz * uniforms.strides - uniforms.pads;
           let hBeg = outTopLeftCorner.x;
           let wBeg = outTopLeftCorner.y;

           var curVal = neg_infinity;
           for (var h = 0; h < uniforms.filterDims[0]; h = h + 1) {
             let hIn = hBeg + h * uniforms.dilations[0];

             if (hIn >= 0 && hIn < uniforms.xShape[1]) {
               for (var w = 0; w < uniforms.filterDims[1]; w = w + 1) {
                 let wIn = wBeg + w * uniforms.dilations[1];

                 if (wIn >= 0 && wIn < uniforms.xShape[2]) {
                   let val = getX(batch, hIn, wIn, d1) + getW(h, w, d1);
                   if (val > curVal) {
                     curVal = val;
                   }
                 }
               }
             }
           }

           setOutputAtIndex(index, curVal);
         }
       }
     `}}let rb={kernelName:d.Dilation2D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s}=t,{strides:o,pad:n,dilations:u}=r,l=d.backend_util.computeDilation2DInfo(a.shape,s.shape,o,n,"NHWC",u),h=[l.padInfo.top,l.padInfo.left],p=[{type:"int32",data:[l.filterHeight,l.filterWidth]},{type:"int32",data:[...h]},{type:"int32",data:[l.strideHeight,l.strideWidth]},{type:"int32",data:[l.dilationHeight,l.dilationWidth]}],c=new rw(l);return i.runWebGPUProgram(c,[a,s],a.dtype,p)}};class rC{constructor(e,t){if(this.variableNames=["x","w","dy"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>, dySize: i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=e.inShape,this.dispatchLayout=L(e.outShape),this.dispatch=D(this.dispatchLayout,e.outShape,this.workgroupSize),"float32"!==t&&"int32"!==t)throw Error(`Dilation2DBackpropInput only supports float32 and int32
          types, does not support ${t} type.`);this.type=t,this.shaderKey="dilation2DBackpropInput"}getUserCode(){return`
       ${S("index")} {
         if (index < uniforms.dySize) {
           let coords = getDyCoordsFromIndex(index);
           let b = coords[0];
           let r = coords[1];
           let c = coords[2];
           let d = coords[3];

           let dyCorner = vec2<i32>(r, c) * uniforms.strides - uniforms.pads;
           var curVal = -3.4e38;  // neg_infinity
           var xRMax = 0;
           var xCMax = 0;

           // In the case of multiple argmax branches, we only back-propagate
           // along the last branch, i.e., the one with largest value of
           // 'wR * uniforms.filterDims[1] + wC', similarly to the max-pooling
           // backward routines.
           for (var wR = 0; wR < uniforms.filterDims[0]; wR++) {
             let xR = dyCorner.x + wR * uniforms.dilations[0];

             if (xR >= 0 && xR < uniforms.xShape[1]) {
               for (var wC = 0; wC < uniforms.filterDims[1]; wC++) {
                 let xC = dyCorner.y + wC * uniforms.dilations[1];

                 if (xC >= 0 && xC < uniforms.xShape[2]) {
                   let val = getX(b, xR, xC, d) + getW(wR, wC, d);
                   if (val > curVal) {
                     curVal = val;
                     xRMax = xR;
                     xCMax = xC;
                   }
                 }
               }
             }
           }

           let flatIndexIn = d + uniforms.xShape[3] *
               (xCMax + uniforms.xShape[2] * (xRMax + uniforms.xShape[1] * b));
           let value = getDy(b, r, c, d);
           ${x("&result[flatIndexIn]","value",this.type)}
         }
       }
     `}}class rS{constructor(e,t,i){if(this.variableNames=["x","w","dy"],this.uniforms="filterDims: vec2<i32>, pads: vec2<i32>, strides: vec2<i32>, dilations: vec2<i32>, dySize: i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=e.filterShape,this.dispatchLayout=L(e.outShape),this.dispatch=D(this.dispatchLayout,e.outShape,this.workgroupSize),"float32"!==i&&"int32"!==i)throw Error(`Dilation2DBackpropFilter only supports float32 and int32
          types, does not support ${i} type.`);this.type=i,this.shaderKey="dilation2DBackpropFilter"}getUserCode(){return`
       ${S("index")} {
         if (index < uniforms.dySize) {
           let coords = getDyCoordsFromIndex(index);
           let b = coords[0];
           let r = coords[1];
           let c = coords[2];
           let d = coords[3];

           let dyCorner = vec2<i32>(r, c) * uniforms.strides - uniforms.pads;
           var curVal = -3.4e38;  // neg_infinity
           var wRMax = 0;
           var wCMax = 0;

           // In the case of multiple argmax branches, we only back-propagate
           // along the last branch, i.e., the one with largest value of
           // 'wR * uniforms.filterDims[1] + wC', similarly to the max-pooling
           // backward routines.
           for (var wR = 0; wR < uniforms.filterDims[0]; wR++) {
             let xR = dyCorner.x + wR * uniforms.dilations[0];

             if (xR >= 0 && xR < uniforms.xShape[1]) {
               for (var wC = 0; wC < uniforms.filterDims[1]; wC++) {
                 let xC = dyCorner.y + wC * uniforms.dilations[1];

                 if (xC >= 0 && xC < uniforms.xShape[2]) {
                   let val = getX(b, xR, xC, d) + getW(wR, wC, d);
                   if (val > curVal) {
                     curVal = val;
                     wRMax = wR;
                     wCMax = wC;
                   }
                 }
               }
             }
           }

           let flatIndexIn = d + uniforms.wShape[2] * (wCMax + wRMax * uniforms.wShape[1]);
           let value = getDy(b, r, c, d);
           ${x("&result[flatIndexIn]","value",this.type)}
         }
       }
     `}}let rv={kernelName:d.Dilation2DBackpropFilter,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s,dy:o}=t,{strides:n,pad:u,dilations:l}=r,h=d.backend_util.computeDilation2DInfo(a.shape,s.shape,n,u,"NHWC",l),p=s.dtype,c=new rS(h,s.shape,p),f=[{type:"int32",data:[h.filterHeight,h.filterWidth]},{type:"int32",data:[h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.dilationHeight,h.dilationWidth]},{type:"int32",data:[d.util.sizeFromShape(h.outShape)]}],m=eO({backend:i,attrs:{shape:s.shape,value:0,dtype:p}});return i.runWebGPUProgram(c,[a,s,o],p,f,m)}},rI={kernelName:d.Dilation2DBackpropInput,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s,dy:o}=t,{strides:n,pad:u,dilations:l}=r,h=d.backend_util.computeDilation2DInfo(a.shape,s.shape,n,u,"NHWC",l),p=a.dtype,c=new rC(h,p),f=[{type:"int32",data:[h.filterHeight,h.filterWidth]},{type:"int32",data:[h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.dilationHeight,h.dilationWidth]},{type:"int32",data:[d.util.sizeFromShape(h.outShape)]}],m=eO({backend:i,attrs:{shape:h.inShape,value:0,dtype:p}});return i.runWebGPUProgram(c,[a,s,o],p,f,m)}};class rk{constructor(e,t,i){this.variableNames=["Image"],this.uniforms="alpha: f32,",this.workgroupSize=[64,1,1],this.pixelsOpType=a.DRAW,this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.type=t,this.textureFormat=i,this.shaderKey=`draw_${t}_${i}`}getUserCode(){let e;let t="float32"===this.type?"value":"value / 255.0";return e=`
      if (uniforms.numChannels == 1) {
        rgba[0] = ${t};
        rgba[1] = ${t};
        rgba[2] = ${t};
      } else {
        rgba[d] = ${t};
      }`,`
       @group(0) @binding(0) var outImage : texture_storage_2d<${this.textureFormat}, write>;
       ${S("index")} {
         if (index < uniforms.size) {
           var rgba = vec4<f32>(0.0, 0.0, 0.0, uniforms.alpha);
           for (var d = 0; d < uniforms.numChannels; d = d + 1) {
             let value = f32(inBuf[index * uniforms.numChannels + d]);
             ${e}
           }
           rgba.x = rgba.x * rgba.w;
           rgba.y = rgba.y * rgba.w;
           rgba.z = rgba.z * rgba.w;
           let coords = getCoordsFromIndex(index);
           textureStore(outImage, vec2<i32>(coords.yx), rgba);
         }
       }
      `}}let rR={kernelName:d.Draw,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{image:s}=i,{canvas:o,options:n}=a,[u,l]=s.shape.slice(0,2),{imageOptions:d}=n||{},h=(null==d?void 0:d.alpha)||1,p=r.device.features.has("bgra8unorm-storage")?"bgra8unorm":"rgba8unorm",c=[u,l],f=new rk(c,s.dtype,p);o.width=l,o.height=u;let m="webgpu",g=o.getContext(m);g||(g=(t=new OffscreenCanvas(l,u)).getContext(m));let x=3===s.shape.length?s.shape[2]:1;g.configure({device:r.device,format:p,usage:GPUTextureUsage.STORAGE_BINDING,alphaMode:"premultiplied"});let y="int32",w=r.makeTensorInfo(c,y),b=r.tensorMap.get(w.dataId);if(b.resource=g.getCurrentTexture(),b.external=!0,r.runWebGPUProgram(f,[s],y,[{type:"uint32",data:[x]},{type:"float32",data:[h]}],w),t){let e=o.getContext("2d");if(!e)throw Error("Please make sure this canvas has only been used for 2d or webgpu context!");e.drawImage(t,0,0)}return r.disposeData(w.dataId),s}},r$=e2({opType:o.MUL,cpuKernelImpl:td,supportsComplex:!0}),rP={kernelName:d.Multiply,backendName:"webgpu",kernelFunc:r$};function rz(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,keepDims:o}=r;return tM(a,s,o,"sum",i)}let rN={kernelName:d.Sum,backendName:"webgpu",kernelFunc:rz},rA={kernelName:d.Einsum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{equation:a}=r,{allDims:s,summedDims:o,idDims:n}=d.backend_util.decodeEinsumEquation(a,t.length);d.backend_util.checkEinsumDimSizes(s.length,n,t);let{path:u,steps:l}=d.backend_util.getEinsumComputePath(o,n),h=l.length,p=null,c=s.length,f=[];for(let e=0;e<h;++e){for(let r of l[e]){let e;let{permutationIndices:a,expandDims:s}=d.backend_util.getEinsumPermutation(c,n[r]);d.backend_util.isIdentityPermutation(a)?e=t[r]:(e=tW({inputs:{x:t[r]},backend:i,attrs:{perm:a}}),f.push(e));let o=e.shape.slice();for(let e=0;e<s.length;++e)o.splice(s[e],0,1);d.util.arraysEqual(e.shape,o)||(e=eV({inputs:{x:e},backend:i,attrs:{shape:o}}),f.push(e)),null===p?p=e:(p=r$({inputs:{a:e,b:p},backend:i}),f.push(p))}e<h-1&&(u[e]>=0&&(p=rz({inputs:{x:p},backend:i,attrs:{axis:u[e]-(s.length-c),keepDims:!1}}),f.push(p)),c--)}for(let e of f)e!==p&&i.disposeData(e.dataId);return p}},rD=eJ({opType:n.ELU}),rF={kernelName:d.Elu,backendName:"webgpu",kernelFunc:rD},r_={kernelName:d.EluGrad,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i}=e,{dy:r,y:a}=t,s=new eK(o.ELU_DER,r.shape,a.shape);return i.runWebGPUProgram(s,[r,a],r.dtype)}},rT=e2({opType:o.EQUAL,dtype:"bool",cpuKernelImpl:e6}),rL={kernelName:d.Equal,backendName:"webgpu",kernelFunc:rT},rE=eJ({opType:n.ERF}),rB={kernelName:d.Erf,backendName:"webgpu",kernelFunc:rE},rW=eJ({opType:n.EXP,cpuKernelImpl:e5,dtype:"float32"}),rO={kernelName:d.Exp,backendName:"webgpu",kernelFunc:rW};function rU(e){let{inputs:t,attrs:i,backend:r}=e,{dim:a}=i,{input:s}=t,o=s.shape.length,n=s.shape.slice(),u=a;return a<0&&(d.util.assert(-(o+1)<=a,()=>`Axis must be in the interval [${-(o+1)}, ${o}]`),u=o+a+1),n.splice(u,0,1),eV({inputs:{x:s},backend:r,attrs:{shape:n}})}let rV={kernelName:d.ExpandDims,backendName:"webgpu",kernelFunc:rU},rM=eJ({opType:n.EXPM1,cpuKernelImpl:e8}),rG={kernelName:d.Expm1,backendName:"webgpu",kernelFunc:rM};class rH{constructor(e,t){this.variableNames=["real","imag"],this.outputShape=[],this.uniforms="exponentMultiplier : f32, denominator: f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.component=e,this.shaderKey=`fft_${e}`}getUserCode(){let e="real"===this.component?"return real * expR - imag * expI;":"return real * expI + imag * expR;";return`
    fn unaryOpComplex(real: f32, expR: f32, imag: f32, expI: f32) -> f32 {
      ${e}
    }

    fn mulMatDFT(batch: i32, index: i32) -> f32 {
      let indexRatio = f32(index) / f32(uniforms.realShape[1]);
      let exponentMultiplierTimesIndexRatio =
          uniforms.exponentMultiplier * indexRatio;

      var result = 0.0;

      for (var i = 0; i < uniforms.realShape[1]; i = i + 1) {
        // x = (-2|2 * PI / N) * index * i;
        let x = exponentMultiplierTimesIndexRatio * f32(i);
        let expR = cos(x);
        let expI = sin(x);
        let real = getReal(batch, i);
        let imag = getImag(batch, i);

        result = result +
            unaryOpComplex(real, expR, imag, expI) / uniforms.denominator;
      }

      return result;
    }

    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        setOutputAtIndex(index, mulMatDFT(coords[0], coords[1]));
      }
    }
  `}}function rX(e,t,i){let r=i.tensorMap.get(e.dataId),a=d.util.sizeFromShape(e.shape),s=e.shape[e.shape.length-1],o=[],n=eV({inputs:{x:e},backend:i,attrs:{shape:[a/s,s]}});o.push(n);let u=n.shape,l=new rH("real",u),h=new rH("imag",u),p=[{dataId:r.complexTensorInfos.real.dataId,dtype:r.complexTensorInfos.real.dtype,shape:u},{dataId:r.complexTensorInfos.imag.dataId,dtype:r.complexTensorInfos.imag.dtype,shape:u}],c=t?u[1]:1,f=[{type:"float32",data:[t?2*Math.PI:-2*Math.PI]},{type:"float32",data:[c]}],m=i.runWebGPUProgram(l,p,"float32",f);o.push(m);let g=i.runWebGPUProgram(h,p,"float32",f);o.push(g);let x=ej({inputs:{real:m,imag:g},backend:i});o.push(x);let y=eV({inputs:{x:x},backend:i,attrs:{shape:e.shape}});return o.forEach(e=>i.disposeData(e.dataId)),y}let rK={kernelName:d.FFT,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{input:r}=t;return rX(r,!1,i)}};class rq{constructor(e){this.outputShape=[],this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="flipLeftRight"}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let coordX = uniforms.xShape[2] - coords[2] - 1;
          let outputValue = getX(coords[0], coords[1], coordX, coords[3]);
          setOutputAtIndex(index, outputValue);
        }
      }
    `}}let rY={kernelName:d.FlipLeftRight,backendName:"webgpu",kernelFunc:({inputs:e,backend:t})=>{let{image:i}=e,r=new rq(i.shape);return t.runWebGPUProgram(r,[i],i.dtype)}},rj=eJ({opType:n.FLOOR,cpuKernelImpl:e9}),rQ={kernelName:d.Floor,backendName:"webgpu",kernelFunc:rj},rZ=e2({opType:o.FLOOR_DIV,cpuKernelImpl:e7,dtype:"int32"}),rJ={kernelName:d.FloorDiv,backendName:"webgpu",kernelFunc:rZ};class r2{constructor(e,t,i=!1){this.pixelsOpType=a.FROM_PIXELS,this.outputShape=[0],this.variableNames=[],this.workgroupSize=[256,1,1],this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[t,1,1]),this.importVideo=i,this.shaderKey=`fromPixels_${this.importVideo}`}getUserCode(){let e=this.importVideo?"textureLoad(src, vec2<i32>(coords.yx));":"textureLoad(src, vec2<i32>(coords.yx), 0)",t=this.importVideo?"texture_external":"texture_2d<f32>";return`
      @binding(1) @group(0) var src: ${t};
      ${S("index")} {
        let flatIndex = index * uniforms.numChannels;
        if (flatIndex < uniforms.size) {
          let coords = getCoordsFromIndex(flatIndex);
          let values = ${e};
          for (var i = 0; i < uniforms.numChannels; i = i + 1) {
            result[flatIndex + i] = i32(floor(255.0 * values[i]));
          }
        }
      }
  `}}let r3={kernelName:d.FromPixels,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:a}=e,{pixels:s}=t,{numChannels:o}=a;if(null==s)throw Error("pixels passed to tf.browser.fromPixels() can not be null");let n="undefined"!=typeof HTMLVideoElement&&s instanceof HTMLVideoElement,u="undefined"!=typeof HTMLImageElement&&s instanceof HTMLImageElement,l="undefined"!=typeof HTMLCanvasElement&&s instanceof HTMLCanvasElement||"undefined"!=typeof OffscreenCanvas&&s instanceof OffscreenCanvas,h="undefined"!=typeof ImageBitmap&&s instanceof ImageBitmap,[p,c]=n?[s.videoWidth,s.videoHeight]:[s.width,s.height],f=[c,p,o],m=(0,d.env)().getBool("WEBGPU_IMPORT_EXTERNAL_TEXTURE")&&n,g=n||u;if(h||l||g){let e;if(m)e=i.device.importExternalTexture({source:s});else{if(g){let e=(0,d.env)().getBool("CANVAS2D_WILL_READ_FREQUENTLY_FOR_GPU");(null==r||e!==r0)&&(r0=e,r=document.createElement("canvas").getContext("2d",{willReadFrequently:r0})),r.canvas.width=p,r.canvas.height=c,r.drawImage(s,0,0,p,c),s=r.canvas}let t=GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING,a=i.textureManager.acquireTexture(f[1],f[0],"rgba8unorm",t);i.queue.copyExternalImageToTexture({source:s},{texture:a},[f[1],f[0]]),e=a}let t=d.util.sizeFromShape(f),a=d.util.computeStrides(f),n=new r2(f,o,m),u=[{type:"uint32",data:[t]},{type:"uint32",data:[o]},{type:"uint32",data:[...a]}],l=i.makeTensorInfo([c,p],"int32");i.tensorMap.get(l.dataId).resource=e;let h=i.runWebGPUProgram(n,[l],"int32",u);return i.disposeData(l.dataId),h}let x=s.data,y=x;if(null!=o&&4!==o){y=new Uint8Array(s.width*s.height*o);let e=x.length,t=0;for(let i=0;i<e;i++)i%4<o&&(y[t++]=x[i])}let w=i.makeTensorInfo(f,"int32",new Int32Array(y));return i.uploadToGPU(w.dataId),w}},r0=(0,d.env)().getBool("CANVAS2D_WILL_READ_FREQUENTLY_FOR_GPU");class r1{constructor(e,t,i,r,a){this.uniforms="varianceEpsilon : f32,",this.workgroupSize=[128,1,1],this.size=!0,this.variableNames=["x","mean","variance"],d.backend_util.assertAndGetBroadcastShape(e,t),d.backend_util.assertAndGetBroadcastShape(e,i),this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),null!=r&&(d.backend_util.assertAndGetBroadcastShape(e,r),this.variableNames.push("offset")),null!=a&&(d.backend_util.assertAndGetBroadcastShape(e,a),this.variableNames.push("scale")),this.offsetShape=r,this.scaleShape=a,this.shaderKey="batchNorm"}getUserCode(){let e="0.0";null!=this.offsetShape&&(e="getOffsetByOutputIndex(index)");let t="1.0";return null!=this.scaleShape&&(t="getScaleByOutputIndex(index)"),`
      ${S("index")} {
        if (index < uniforms.size)
        {
          let xValue = getXByOutputIndex(index);
          let meanValue = getMeanByOutputIndex(index);
          let varianValue = getVarianceByOutputIndex(index);
          let offsetValue = ${e};
          let scaleValue = ${t};
          let inv = scaleValue * inverseSqrt(varianValue + f32(uniforms.varianceEpsilon));
          setOutputAtIndex(index,dot(vec3<f32>(xValue, -meanValue, offsetValue), vec3<f32>(inv, inv, 1.0)));
        }
      }
  `}}let r4={kernelName:d.FusedBatchNorm,backendName:"webgpu",kernelFunc:({inputs:e,attrs:t,backend:i})=>{let{x:r,scale:a,offset:s,mean:o,variance:n}=e,{varianceEpsilon:u}=t,l=[r,o,n],d=null;null!=s&&(d=s.shape,l.push(s));let h=null;null!=a&&(h=a.shape,l.push(a));let p=new r1(r.shape,o.shape,n.shape,d,h);return i.runWebGPUProgram(p,l,r.dtype,[{type:"float32",data:[u]}])}},r6={kernelName:d.FusedConv2D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,filter:s,bias:o,preluActivationWeights:n}=t,{strides:u,pad:l,dataFormat:h,dilations:p,dimRoundingMode:c,activation:f,leakyreluAlpha:m}=r,g=d.backend_util.convertConv2DDataFormat(h),x=d.backend_util.computeConv2DInfo(a.shape,s.shape,u,p,l,c,!1,g);return iH({x:a,filter:s,convInfo:x,backend:i,bias:o,preluActivationWeights:n,leakyreluAlpha:m,activation:f})}},r5={kernelName:d.FusedDepthwiseConv2D,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s,filter:o,bias:n,preluActivationWeights:u}=i,{strides:l,pad:h,dilations:p,dimRoundingMode:c,activation:f,leakyreluAlpha:m}=a,g=p;null==g&&(g=[1,1]),d.util.assert(d.backend_util.eitherStridesOrDilationsAreOne(l,g),()=>`Error in depthwiseConv2d: Either strides or dilations must be 1. Got strides ${l} and dilations '${g}'`);let x=d.backend_util.computeConv2DInfo(s.shape,o.shape,l,g,h,c,!0),y=[s,o],w=null!=n,b=null!=u;w&&y.push(n),b&&y.push(u);let C=[{type:"int32",data:[x.padInfo.top,x.padInfo.left]},{type:"int32",data:[x.inHeight,x.inWidth]}];return x.outHeight>4&&x.outWidth>4&&x.strideWidth<=2&&x.inChannels===x.outChannels&&1===x.dilationHeight&&1===x.dilationWidth&&x.inChannels%4==0?(t=new rd(x,w,f,b),C.push({type:"int32",data:[t.virtualWidth]})):(t=new rh(x,w,f,b),C.push({type:"int32",data:[x.filterHeight]},{type:"int32",data:[x.filterWidth]},{type:"int32",data:[x.strideHeight,x.strideWidth]},{type:"int32",data:[x.dilationHeight,x.dilationWidth]})),"leakyrelu"===f&&(C.push({type:"float32",data:[m]}),t.uniforms+=" alpha : f32,"),r.runWebGPUProgram(t,y,"float32",C)}};class r8{constructor(e,t){this.variableNames=["A","indices"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey=`gathernd_${e}`,this.sliceDim=e,this.uniforms=`sliceDim : i32, strides : ${b(e)},`}getUserCode(){let e;return e=this.sliceDim>1?"uniforms.strides[j]":"uniforms.strides",`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          var flattenIndex = 0;
          for (var j = 0; j < uniforms.sliceDim; j = j + 1) {
            let indexTemp = i32(round(getIndices(coords[0], j)));
            let strideNum = ${e};
            flattenIndex = flattenIndex + indexTemp * strideNum;
          }

          setOutputAtIndex(index, getA(flattenIndex, coords[1]));
        }
      }
      `}}let r9={kernelName:d.GatherNd,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{params:r,indices:a}=t,s=a.shape,o=s[s.length-1],n=d.util.sizeFromShape(r.shape),[u,l,h,p]=d.backend_util.prepareAndValidate(r,a),c=eV({inputs:{x:a},backend:i,attrs:{shape:[l,o]}}),f=eV({inputs:{x:r},backend:i,attrs:{shape:[d.util.sizeFromShape(r.shape)/h,h]}});if(i.shouldExecuteOnCPU([r,a])||"string"===r.dtype){let e=te(i.readSync(a.dataId),i.bufferSync(r),r.dtype,l,o,h,p,r.shape,n);return i.makeTensorInfo(u,r.dtype,e.values)}let m=new r8(o,[l,h]),g=[{type:"int32",data:[o]},{type:"int32",data:p}],x=i.runWebGPUProgram(m,[f,c],f.dtype,g),y=eV({inputs:{x:x},backend:i,attrs:{shape:u}});return i.disposeData(c.dataId),i.disposeData(f.dataId),i.disposeData(x.dataId),y}};class r7{constructor(e,t){this.variableNames=["A","indices"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.slice(),this.aShape=e,this.outputShape=t,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="gather"}getUserCode(){let e=function(e){let t=["resRC.x","resRC.y","resRC.z","resRC.w"],i=[];for(let r=0;r<e.length;r++)2===r?i.push("indexZ"):i.push(`${t[r]}`);return i.join()}(this.aShape);return`
      ${S("index")} {
        if (index < uniforms.size) {
          let resRC = getCoordsFromIndex(index);
          let indexZ = i32(getIndices(resRC.x, resRC.z));
          let inBounds = select(0.0, 1.0, indexZ >= 0 && indexZ < uniforms.aShape[2]);
          setOutputAtIndex(index, inBounds * getA(${e}));
        }
      }
    `}}function ae(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,indices:s}=t,{axis:o,batchDims:n}=r,u=d.util.parseAxisParam(o,a.shape)[0],l=d.backend_util.segment_util.collectGatherOpShapeInfo(a,s,u,n),h=d.util.sizeFromShape(s.shape),p=[],c=eV({inputs:{x:a},backend:i,attrs:{shape:[l.batchSize,l.outerSize,l.dimSize,l.sliceSize]}}),f=eV({inputs:{x:s},backend:i,attrs:{shape:[l.batchSize,h/l.batchSize]}});p.push(c),p.push(f);let m=[l.batchSize,l.outerSize,h/l.batchSize,l.sliceSize];if(i.shouldExecuteOnCPU([a,s])){let e=i.tensorMap.get(f.dataId).values,t=(0,d.buffer)(f.shape,f.dtype,e),r=i.tensorMap.get(c.dataId).values,a=tt((0,d.buffer)(c.shape,c.dtype,r),t,m);return p.forEach(e=>i.disposeData(e.dataId)),i.makeTensorInfo(l.outputShape,a.dtype,a.values)}let g=new r7(c.shape,m),x=i.runWebGPUProgram(g,[c,f],c.dtype);p.push(x);let y=eV({inputs:{x:x},backend:i,attrs:{shape:l.outputShape}});return p.forEach(e=>i.disposeData(e.dataId)),y}let at={kernelName:d.GatherV2,backendName:"webgpu",kernelFunc:ae},ai=e2({opType:o.GREATER,cpuKernelImpl:tr,dtype:"bool"}),ar={kernelName:d.Greater,backendName:"webgpu",kernelFunc:ai},aa=e2({opType:o.GREATER_EQUAL,dtype:"bool",cpuKernelImpl:ti}),as={kernelName:d.GreaterEqual,backendName:"webgpu",kernelFunc:aa},ao={kernelName:d.IFFT,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{input:r}=t;return rX(r,!0,i)}},an=eJ({opType:n.IS_FINITE,dtype:"bool"}),au={kernelName:d.IsFinite,backendName:"webgpu",kernelFunc:an},al=eJ({opType:n.IS_INF,dtype:"bool"}),ad={kernelName:d.IsInf,backendName:"webgpu",kernelFunc:al},ah=eJ({opType:n.IS_NAN,dtype:"bool"}),ap={kernelName:d.IsNan,backendName:"webgpu",kernelFunc:ah},ac={kernelName:d.LeakyRelu,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{alpha:s}=r,o=new eZ(a.shape,n.LEAKYRELU,"alpha : f32,");return i.runWebGPUProgram(o,[a],"float32",[{type:"float32",data:[s]}])}},af=e2({opType:o.LESS,dtype:"bool",cpuKernelImpl:ts}),am={kernelName:d.Less,backendName:"webgpu",kernelFunc:af},ag=e2({opType:o.LESS_EQUAL,dtype:"bool",cpuKernelImpl:ta}),ax={kernelName:d.LessEqual,backendName:"webgpu",kernelFunc:ag};class ay{constructor(e){this.variableNames=[],this.outputShape=[],this.uniforms="start : f32, step : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="linSpace"}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          setOutputAtIndex(index, uniforms.start + f32(index) * uniforms.step);
        }
      }
    `}}let aw={kernelName:d.LinSpace,backendName:"webgpu",kernelFunc:function(e){let{backend:t,attrs:i}=e,{start:r,stop:a,num:s}=i,o=(a-r)/(s-1),n=new ay(s);return t.runWebGPUProgram(n,[],"float32",[{type:"float32",data:[r]},{type:"float32",data:[o]}])}},ab=eJ({opType:n.LOG,cpuKernelImpl:to}),aC={kernelName:d.Log,backendName:"webgpu",kernelFunc:ab},aS=eJ({opType:n.LOG1P}),av={kernelName:d.Log1p,backendName:"webgpu",kernelFunc:aS},aI=e2({opType:o.LOGICAL_AND,dtype:"bool"}),ak={kernelName:d.LogicalAnd,backendName:"webgpu",kernelFunc:aI},aR=eJ({opType:n.LOGICAL_NOT}),a$={kernelName:d.LogicalNot,backendName:"webgpu",kernelFunc:aR},aP=e2({opType:o.LOGICAL_OR}),az={kernelName:d.LogicalOr,backendName:"webgpu",kernelFunc:aP},aN=`
  var powValue = 0.0;
  let basis = uniforms.bias + uniforms.alpha * sum;
  if (uniforms.beta == 0.5) {
    powValue = inverseSqrt(basis);
  } else if (uniforms.beta == 1.0) {
    powValue = 1.0 / basis;
  } else {
    powValue = exp(log(basis) * (-uniforms.beta));
  }
`;class aA{constructor(e){this.outputShape=[],this.variableNames=["x"],this.uniforms="radius : i32, bias : f32, alpha : f32, beta : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="lrn"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let b = coords[0];
        let r = coords[1];
        let c = coords[2];
        let d = coords[3];

        let x = getX(b, r, c, d);
        var sum = 0.0;
        for (var i = -uniforms.radius; i <= uniforms.radius; i = i + 1) {
          let idx = d + i;
          if (idx >= 0 && idx < uniforms.xShape[3]) {
            let z = getX(b, r, c, idx);
            sum = sum + z * z;
          }
        }
        ${aN}

        setOutputAtIndex(index, x * powValue);
      }
    }
  `}}class aD{constructor(e,t){this.outputShape=[],this.variableNames=["x"],this.uniforms="radius : i32, bias : f32, alpha : f32, beta : f32,",this.workgroupSize=[256,1,1],this.maxAllowRadius=16,d.util.assert(t<=this.maxAllowRadius,()=>`Radius must be less than or equal to ${this.maxAllowRadius}, current radius is ${t}`),this.outputShape=e,this.elementsPerWorkgroup=this.workgroupSize[0]-2*this.maxAllowRadius,this.dispatchLayout={x:[3],y:[2],z:[0,1]},this.dispatch=D(this.dispatchLayout,this.outputShape,[this.elementsPerWorkgroup,this.workgroupSize[1],this.workgroupSize[2]]),this.shaderKey="lrn_shared"}getUserCode(){return`
    var <workgroup>lrnSub: array<f32, ${this.workgroupSize[0]}>;
    const elementsPerWorkgroup = ${this.elementsPerWorkgroup};
    const maxAllowRadius = ${this.maxAllowRadius};

    ${S()} {
      let localDepth = i32(localId.x);
      let workgroupDepth = i32(workgroupId.x) * elementsPerWorkgroup;
      let xDepth = workgroupDepth + localDepth - maxAllowRadius;
      let b = i32(globalId.z) / uniforms.xShape[1];
      let r = i32(globalId.z) - b * uniforms.xShape[1];
      let c = i32(globalId.y);
      let d = workgroupDepth + localDepth;

      var x = 0.0;
      if (xDepth >= 0 && xDepth < uniforms.xShape[3]) {
        x = getX(b, r, c, xDepth);
      }
      lrnSub[localDepth] = x;
      workgroupBarrier();

      if (localDepth < elementsPerWorkgroup && d < uniforms.outShape[3]) {
        var sum = 0.0;
        let index = localDepth + maxAllowRadius;
        for (var i = -uniforms.radius; i <= uniforms.radius; i = i + 1) {
          let z = lrnSub[index + i];
          sum = sum + z * z;
        }
        ${aN}

        setOutputAtCoords(b, r, c, d, lrnSub[index] * powValue);
      }
    } `}}let aF={kernelName:d.LRN,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s}=i,{depthRadius:o,bias:n,alpha:u,beta:l}=a;t=o>16?new aA(s.shape):new aD(s.shape,o);let d=[{type:"int32",data:[o]},{type:"float32",data:[n]},{type:"float32",data:[u]},{type:"float32",data:[l]}];return r.runWebGPUProgram(t,[s],s.dtype,d)}};class a_{constructor(e){this.outputShape=[],this.variableNames=["inputImage","outputImage","dy"],this.uniforms="depthRadius : i32, bias : f32, alpha : f32, beta : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="lrn_grad"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let b = coords[0];
        let r = coords[1];
        let c = coords[2];

        let MIN_DEPTH_BEGIN = 0;
        let MAX_DEPTH_END = uniforms.outShape[3];
        var result = 0.0;
        for (var d = MIN_DEPTH_BEGIN; d < MAX_DEPTH_END; d++) {
          let depthBegin = max(MIN_DEPTH_BEGIN, d - uniforms.depthRadius);
          let depthEnd = min(MAX_DEPTH_END, d + uniforms.depthRadius + 1);

          var norm = 0.0;
          for (var k = MIN_DEPTH_BEGIN; k < MAX_DEPTH_END; k++) {
            if (k < depthBegin) {
              continue;
            } else if (k >= depthBegin && k < depthEnd) {
              norm += getInputImage(b, r, c, k) * getInputImage(b, r, c, k);
            } else {
              break;
            }
          }

          norm = uniforms.alpha * norm + uniforms.bias;

          for (var k = MIN_DEPTH_BEGIN; k < MAX_DEPTH_END; k++) {
            if (k < depthBegin) {
              continue;
            } else if (k >= depthBegin && k < depthEnd) {
              var dyi = -2.0 * uniforms.alpha * uniforms.beta
                * getInputImage(b, r, c, k) * getOutputImage(b, r, c, d) / norm;
              if (k == d) {
                dyi += pow(norm, -1.0 * uniforms.beta);
              }
              if (k == coords[3]) {
                dyi *= getDy(b, r, c, d);
                result += dyi;
              }
            } else {
              break;
            }
          }
        }

        setOutputAtIndex(index, result);
      }
    }
  `}}let aT={kernelName:d.LRNGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,y:s,dy:o}=t,{depthRadius:n,bias:u,alpha:l,beta:d}=r,h=new a_(a.shape);return i.runWebGPUProgram(h,[a,s,o],a.dtype,[{type:"int32",data:[n]},{type:"float32",data:[u]},{type:"float32",data:[l]},{type:"float32",data:[d]}])}},aL=e2({opType:o.MAX,cpuKernelImpl:tu}),aE={kernelName:d.Maximum,backendName:"webgpu",kernelFunc:aL},aB={kernelName:d.MaxPool,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dimRoundingMode:u}=r,l=d.backend_util.computePool2DInfo(a.shape,s,o,1,n,u);return ii(a,l,"max",i)}},aW={kernelName:d.MaxPool3D,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{filterSize:s,strides:o,pad:n,dataFormat:u,dimRoundingMode:l}=r,h=d.backend_util.computePool3DInfo(a.shape,s,o,[1,1,1],n,l,u),p=new t8(h,"max"),c=[{type:"int32",data:[h.strideDepth,h.strideHeight,h.strideWidth]},{type:"int32",data:[h.padInfo.front,h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.inDepth,h.inHeight,h.inWidth]},{type:"int32",data:[h.effectiveFilterDepth,h.effectiveFilterHeight,h.effectiveFilterWidth]}];return i.runWebGPUProgram(p,[a],a.dtype,c)}};class aO{constructor(e){this.variableNames=["dy","maxPos"],this.uniforms=`strides : vec2<i32>, pads : vec2<i32>, dilations : vec2<i32>, filterDims : vec2<i32>,
       outHeight : i32, outWidth : i32`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="maxPool2DBackprop"}getUserCode(){return`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords[0];
        let d = coords[3];

        let dyRCCorner = vec2<i32>(coords.yz) - uniforms.pads;
        let dyRCorner = dyRCCorner.x;
        let dyCCorner = dyRCCorner.y;

        // Convolve dy(?, ?, d) with pos mask(:, :, d) to get dx(xR, xC, d).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        let lastIndex = uniforms.filterDims[0] * uniforms.filterDims[1] - 1;
        for (var wR = 0; wR < uniforms.filterDims[0]; wR += uniforms.dilations[0]) {
          let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[0]);

          if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
            continue;
          }
          let idyR = i32(dyR);

          for (var wC = 0; wC < uniforms.filterDims[1]; wC += uniforms.dilations[1]) {
            let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[1]);

            if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
              continue;
            }
            let idyC = i32(dyC);

            let dyValue = getDy(batch, idyR, idyC, d);
            let maxPosValue = lastIndex - i32(getMaxPos(batch, idyR, idyC, d));

            // Get the current value, check it against the value from the
            // position matrix.
            let curPosValue = wR * uniforms.filterDims[1] + wC;
            let mask = select(0.0, 1.0, maxPosValue == curPosValue);
            dotProd += dyValue * mask;
          }
        }
        setOutputAtIndex(index, dotProd);
      }
    }
    `}}class aU{constructor(e){this.variableNames=["dy","maxPos"],this.uniforms=`strides : vec3<i32>, pads : vec3<i32>, filterDims : vec3<i32>,
      outDepth : i32, outHeight : i32, outWidth : i32`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e.inShape,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="maxPool3DBackprop"}getUserCode(){return`
      ${S("index")} {
      if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
        let batch = coords.x;
        let ch = coords.u;

        let dyCorner = vec3<i32>(coords.y, coords.z, coords.w) - uniforms.pads;
        let dyDCorner = dyCorner.x;
        let dyRCorner = dyCorner.y;
        let dyCCorner = dyCorner.z;

        // Convolve dy(?, ?, ?, ch) with pos mask(:, :, :, d) to get
        // dx(xD, xR, xC, ch).
        // ? = to be determined. : = across all values in that axis.
        var dotProd = 0.0;
        let lastIndex = uniforms.filterDims[0] * uniforms.filterDims[1] * uniforms.filterDims[2] - 1;

        for (var wD = 0; wD < uniforms.filterDims[0]; wD++) {
          let dyD = f32(dyDCorner + wD) / f32(uniforms.strides[0]);

          if (dyD < 0.0 || dyD >= f32(uniforms.outDepth) || fract(dyD) > 0.0) {
            continue;
          }
          let idyD = i32(dyD);

          for (var wR = 0; wR < uniforms.filterDims[1]; wR++) {
            let dyR = f32(dyRCorner + wR) / f32(uniforms.strides[1]);

            if (dyR < 0.0 || dyR >= f32(uniforms.outHeight) || fract(dyR) > 0.0) {
              continue;
            }
            let idyR = i32(dyR);

            for (var wC = 0; wC < uniforms.filterDims[2]; wC++) {
              let dyC = f32(dyCCorner + wC) / f32(uniforms.strides[2]);

              if (dyC < 0.0 || dyC >= f32(uniforms.outWidth) || fract(dyC) > 0.0) {
                continue;
              }
              let idyC = i32(dyC);

              let dyValue = getDy(batch, idyD, idyR, idyC, ch);
              let maxPosValue = lastIndex - i32(getMaxPos(batch, idyD, idyR, idyC, ch));

              // Get the current value, check it against the value from the
              // position matrix.
              let curPosValue = wD * uniforms.filterDims[1] * uniforms.filterDims[2] + wR * uniforms.filterDims[2] + wC;
              let mask = select(0.0, 1.0, maxPosValue == curPosValue);
              dotProd += dyValue * mask;
            }
          }
        }

        setOutputAtIndex(index, dotProd);
      }
    }
    `}}let aV={kernelName:d.MaxPool3DGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s}=t,{filterSize:o,strides:n,pad:u,dimRoundingMode:l}=r,h=d.backend_util.computePool3DInfo(s.shape,o,n,[1,1,1],u,l),p=new t8(h,"max",!0),c=[{type:"int32",data:[h.strideDepth,h.strideHeight,h.strideWidth]},{type:"int32",data:[h.padInfo.front,h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.inDepth,h.inHeight,h.inWidth]},{type:"int32",data:[h.effectiveFilterDepth,h.effectiveFilterHeight,h.effectiveFilterWidth]}],f=i.runWebGPUProgram(p,[s],"int32",c),m=new aU(h);c=[{type:"int32",data:[h.strideDepth,h.strideHeight,h.strideWidth]},{type:"int32",data:[h.effectiveFilterDepth-1-h.padInfo.front,h.effectiveFilterHeight-1-h.padInfo.top,h.effectiveFilterWidth-1-h.padInfo.left]},{type:"int32",data:[h.effectiveFilterDepth,h.effectiveFilterHeight,h.effectiveFilterWidth]},{type:"int32",data:[h.outDepth]},{type:"int32",data:[h.outHeight]},{type:"int32",data:[h.outWidth]}];let g=i.runWebGPUProgram(m,[a,f],s.dtype,c);return i.disposeData(f.dataId),g}},aM={kernelName:d.MaxPoolGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{dy:a,input:s,output:o}=t;W([s,o],"maxPoolGrad");let{filterSize:n,strides:u,pad:l,dimRoundingMode:h}=r,p=d.backend_util.computePool2DInfo(s.shape,n,u,1,l,h),c=new t5(p,"max",!0),f=[{type:"int32",data:[p.strideHeight,p.strideWidth]},{type:"int32",data:[p.padInfo.top,p.padInfo.left]},{type:"int32",data:[p.dilationHeight,p.dilationWidth]},{type:"int32",data:[p.inHeight,p.inWidth]},{type:"int32",data:[p.effectiveFilterHeight,p.effectiveFilterWidth]}],m=i.runWebGPUProgram(c,[s],"int32",f),g=new aO(p);f=[{type:"int32",data:[p.strideHeight,p.strideWidth]},{type:"int32",data:[p.effectiveFilterHeight-1-p.padInfo.top,p.effectiveFilterWidth-1-p.padInfo.left]},{type:"int32",data:[p.dilationHeight,p.dilationWidth]},{type:"int32",data:[p.effectiveFilterHeight,p.effectiveFilterWidth]},{type:"int32",data:[p.outHeight]},{type:"int32",data:[p.outWidth]}];let x=i.runWebGPUProgram(g,[a,m],s.dtype,f);return i.disposeData(m.dataId),x}},aG={kernelName:d.MaxPoolWithArgmax,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{filterSize:a,strides:s,pad:o,includeBatchInIndex:n}=r,{x:u}=t;d.util.assert(4===u.shape.length,()=>`Error in maxPool: input must be rank 4 but got rank ${u.shape.length}.`);let l=[1,1];d.util.assert(d.backend_util.eitherStridesOrDilationsAreOne(s,l),()=>`Error in maxPool: Either strides or dilations must be 1. Got strides ${s} and dilations '${l}'`);let h=d.backend_util.computePool2DInfo(u.shape,a,s,l,o),p=[{type:"int32",data:[h.strideHeight,h.strideWidth]},{type:"int32",data:[h.padInfo.top,h.padInfo.left]},{type:"int32",data:[h.dilationHeight,h.dilationWidth]},{type:"int32",data:[h.inHeight,h.inWidth]},{type:"int32",data:[h.effectiveFilterHeight,h.effectiveFilterWidth]}],c=new t5(h,"max",!1),f=i.runWebGPUProgram(c,[u],u.dtype,p);return c=new t5(h,"max",!0,!0,n),[f,i.runWebGPUProgram(c,[u],"int32",p)]}},aH={kernelName:d.Min,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,keepDims:o}=r;return tM(a,s,o,"min",i)}},aX=e2({opType:o.MIN,cpuKernelImpl:tl}),aK={kernelName:d.Minimum,backendName:"webgpu",kernelFunc:aX};class aq{constructor(e,t,i){this.uniforms="",this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t.map((t,i)=>t[0]+e[i]+t[1]),this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.xShape=e,t.map((e,t)=>{this.uniforms+=` pad${t} : vec2<i32>,`}),this.offset="reflect"===i?0:1,this.shaderKey=`mirrorPad_${i}`}getUserCode(){let e=this.xShape.length,t=this.xShape.map((e,t)=>`uniforms.pad${t}[0]`).join(","),i=this.xShape.map((t,i)=>`uniforms.pad${i}[0] + uniforms.xShape${e>1?`[${i}]`:""}`).join(","),r=1===e?"start":"start[i]",a=1===e?"end":"end[i]",s=1===e?"outC":"outC[i]",o=b(e),n=e>1?["coords[0]","coords[1]","coords[2]","coords[3]"].slice(0,e):"coords";return`
      ${S("index")} {
        if (index < uniforms.size) {
          let start = ${o}(${t});
          let end = ${o}(${i});
          var outC = getCoordsFromIndex(index);
          for (var i = 0; i < ${e}; i = i + 1) {
            if (${s} < ${r}) {
              ${s} = ${r} * 2 - ${s} - ${this.offset};
            } else if(${s} >= ${a}) {
              ${s} = (${a} - 1) * 2 - ${s} + ${this.offset};
            }
          }
          let coords = outC - start;
          setOutputAtIndex(index, getX(${n}));
        }
      }
    `}}let aY={kernelName:d.MirrorPad,backendName:"webgpu",kernelFunc:({inputs:e,attrs:t,backend:i})=>{let{x:r}=e,{paddings:a,mode:s}=t,o=a.map(e=>({type:"int32",data:[e[0],e[1]]})),n=new aq(r.shape,a,s);return i.runWebGPUProgram(n,[r],r.dtype,o)}},aj=e2({opType:o.MOD}),aQ={kernelName:d.Mod,backendName:"webgpu",kernelFunc:aj};class aZ{constructor(e,t){this.variableNames=["probs"],this.outputShape=[],this.uniforms="seed : f32, numOutcomes: i32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e,t],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="multinomial"}getUserCode(){return`
    //Based on the work of Dave Hoskins
    //https://www.shadertoy.com/view/4djSRW
    fn random (seed : f32, resultUV : vec2<f32>) -> f32 {
      let HASHSCALE1 = 443.8975;
      let p = resultUV * seed;
      var p3  = fract(vec3<f32>(p.xyx) * HASHSCALE1);
      p3 = p3 + dot(p3, p3.yzx + 19.19);
      return fract((p3.x + p3.y) * p3.z);
    }

    ${S("index")} {
      if (index < uniforms.size) {
        let coords = getOutputCoords();
        let batch = coords[0];

        let resUV = vec2<f32>(f32(coords[1]) / f32(uniforms.outShape[1]),
            f32(coords[0]) / f32(uniforms.outShape[0]));
        let r = random(uniforms.seed, resUV);
        var cdf = 0.0;
        for (var i = 0; i < uniforms.numOutcomes - 1; i = i + 1) {
          cdf = cdf + getProbs(batch, i);

          if (r < cdf) {
            setOutputAtIndexI32(index, i);
            return;
          }
        }

        // If no other event happened, last event happened.
        setOutputAtIndexI32(index, uniforms.numOutcomes - 1);
      }
    }
  `}}class aJ{constructor(e){this.variableNames=["logits"],this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=[this.outputShape[0],1,1],this.outputShape[1]>=4096?this.workgroupSize=[256,1,1]:this.workgroupSize=[64,1,1],this.shaderKey="softmax"}getUserCode(){return`
    var<workgroup> buf : array<f32, ${this.workgroupSize[0]}>;
    var<workgroup> rowMaxShared : f32;
    var<workgroup> rowSumShared : f32;
    const blockSize = ${this.workgroupSize[0]};
    ${S("index")} {
      let row = index / blockSize;
      let tid = i32(localId.x);
      let cols = uniforms.outShape[1];

      var threadMax = -3.402823e+38f;
      for (var col = tid; col < cols; col += blockSize) {
        let value = getLogits(row, col);
        threadMax = max(threadMax, value);
      }
      if (tid < cols) {
        buf[tid] = threadMax;
      }
      workgroupBarrier();

      var reduceSize = min(cols, blockSize);
      for (var currSize = reduceSize >> 1;  currSize > 0; currSize = reduceSize >> 1) {
        reduceSize = currSize + (reduceSize & 1);
        if (tid < currSize) {
          buf[tid] = max(buf[tid], buf[tid + reduceSize]);
        }
        workgroupBarrier();
      }

      if (tid == 0) {
        rowMaxShared = buf[0];
      }
      workgroupBarrier();

      var threadSum = 0.0;
      for (var col = tid; col < cols; col += blockSize) {
        let subExp = exp(getLogits(row, col) - rowMaxShared);
        threadSum += subExp;
      }
      buf[tid] = threadSum;
      workgroupBarrier();

      for (var currSize = blockSize >> 1;  currSize > 0; currSize = currSize >> 1) {
        if (tid < currSize) {
          buf[tid] = buf[tid] + buf[tid + currSize];
        }
        workgroupBarrier();
      }

      if (tid == 0) {
        rowSumShared = buf[0];
      }
      workgroupBarrier();

      for (var col = tid; col < cols; col += blockSize) {
        let value = exp(getLogits(row, col) - rowMaxShared) / rowSumShared;
        setOutputAtCoords(row, col, value);
      }
  }
    `}}function a2(e){let{inputs:t,backend:i,attrs:r}=e,{logits:a}=t,{dim:s}=r,o=eV({inputs:{x:a},backend:i,attrs:{shape:[d.util.sizeFromShape(a.shape)/a.shape[s],a.shape[s]]}}),n=new aJ(o.shape),u=i.runWebGPUProgram(n,[o],a.dtype),l=eV({inputs:{x:u},backend:i,attrs:{shape:a.shape}});return i.disposeData(o.dataId),i.disposeData(u.dataId),l}let a3={kernelName:d.Softmax,backendName:"webgpu",kernelFunc:a2},a0={kernelName:d.Multinomial,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{logits:a}=t,{numSamples:s,seed:o,normalized:n}=r,u=n?a:a2({inputs:{logits:a},backend:i,attrs:{dim:a.shape.length-1}}),l=u.shape[0],d=u.shape[1],h=new aZ(l,s),p=i.runWebGPUProgram(h,[u],"int32",[{type:"float32",data:[o]},{type:"int32",data:[d]}]);return n||i.disposeData(u.dataId),p}},a1={kernelName:d.Neg,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r}=t;if(i.shouldExecuteOnCPU([r])){let[e,t]=th(i.tensorMap.get(r.dataId).values,r.shape,r.dtype);return i.makeTensorInfo(t,r.dtype,e)}let a=new eZ(r.shape,n.NEG);return i.runWebGPUProgram(a,[r],r.dtype)}},a4={kernelName:d.NonMaxSuppressionV3,backendName:"webgpu",kernelFunc:function(e){console.warn("tf.nonMaxSuppression() in webgpu locks the UI thread. Call tf.nonMaxSuppressionAsync() instead");let{inputs:t,backend:i,attrs:r}=e,{boxes:a,scores:s}=t,{maxOutputSize:o,iouThreshold:n,scoreThreshold:u}=r,l=i.readSync(a.dataId),h=i.readSync(s.dataId),{selectedIndices:p}=d.kernel_impls.nonMaxSuppressionV3Impl(l,h,o,n,u);return i.makeTensorInfo([p.length],"int32",new Int32Array(p))}},a6={kernelName:d.NonMaxSuppressionV5,backendName:"webgpu",kernelFunc:function(e){console.warn("tf.nonMaxSuppression() in webgpu locks the UI thread. Call tf.nonMaxSuppressionAsync() instead");let{inputs:t,backend:i,attrs:r}=e,{boxes:a,scores:s}=t,{maxOutputSize:o,iouThreshold:n,scoreThreshold:u,softNmsSigma:l}=r,h=i.readSync(a.dataId),p=i.readSync(s.dataId),{selectedIndices:c,selectedScores:f}=d.kernel_impls.nonMaxSuppressionV5Impl(h,p,o,n,u,l);return[i.makeTensorInfo([c.length],"int32",new Int32Array(c)),i.makeTensorInfo([f.length],"float32",new Float32Array(f))]}};class a5{constructor(e,t){this.variableNames=["x"],this.uniforms="onValue : f32, offValue : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e,t],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="onehot"}getUserCode(){return`
      ${S("index")} {
        if(index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          setOutputAtIndex(index, mix(uniforms.offValue, uniforms.onValue,
                                      f32(i32(round(getX(coords.x))) == coords.y)));
        }
      }
    `}}let a8={kernelName:d.OneHot,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{indices:a}=t,{dtype:s,depth:o,onValue:n,offValue:u}=r,l=d.util.sizeFromShape(a.shape),h=new a5(l,o),p=eV({inputs:{x:a},backend:i,attrs:{shape:[l]}}),c=i.runWebGPUProgram(h,[p],s,[{type:"float32",data:[n]},{type:"float32",data:[u]}]);i.disposeData(p.dataId);let f=eV({inputs:{x:c},backend:i,attrs:{shape:[...a.shape,o]}});return i.disposeData(c.dataId),f}};function a9(e){let{inputs:t,backend:i}=e,{x:r}=t;if("complex64"!==r.dtype)return eO({attrs:{shape:r.shape,dtype:r.dtype,value:"string"===r.dtype?"":0},backend:i});{let e=ik({inputs:{input:r},backend:i}),t=a9({inputs:{x:e},backend:i}),a=iE({inputs:{input:r},backend:i}),s=a9({inputs:{x:a},backend:i}),o=ej({inputs:{real:t,imag:s},backend:i});return i.disposeData(e.dataId),i.disposeData(t.dataId),i.disposeData(a.dataId),i.disposeData(s.dataId),o}}let a7={kernelName:d.ZerosLike,backendName:"webgpu",kernelFunc:a9},se={kernelName:d.OnesLike,backendName:"webgpu",kernelFunc:function e(t){let{inputs:i,backend:r}=t,{x:a}=i;if("string"===a.dtype)throw Error("onesLike is not supported under string dtype");if("complex64"!==a.dtype)return eO({attrs:{shape:a.shape,dtype:a.dtype,value:1},backend:r});{let t=ik({inputs:{input:a},backend:r}),i=e({inputs:{x:t},backend:r}),s=iE({inputs:{input:a},backend:r}),o=a9({inputs:{x:s},backend:r}),n=ej({inputs:{real:i,imag:o},backend:r});return r.disposeData(t.dataId),r.disposeData(i.dataId),r.disposeData(s.dataId),r.disposeData(o.dataId),n}}},st={kernelName:d.Pack,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{axis:a}=r;if(1===t.length)return rU({inputs:{input:t[0]},backend:i,attrs:{dim:a}});let s=t[0].shape,o=t[0].dtype;t.forEach(e=>{d.util.assertShapesMatch(s,e.shape,"All tensors passed to stack must have matching shapes"),d.util.assert(o===e.dtype,()=>"All tensors passed to stack must have matching dtypes")});let n=[],u=iW({inputs:t.map(e=>{let t=rU({inputs:{input:e},backend:i,attrs:{dim:a}});return n.push(t),t}),backend:i,attrs:{axis:a}});return n.forEach(e=>i.disposeData(e.dataId)),u}};function si(e,t=!1){let i=e.length,r=b(i),a=e.map((e,t)=>`uniforms.pad${t}[0]`).join(","),s=e.map((e,t)=>`uniforms.pad${t}[0] + uniforms.xShape${i>1?`[${t}]`:""}`).join(","),o=i>1?`${r}(${a})`:`${a}`,n=i>1?`${r}(${s})`:`${s}`,u=i>1?"any(paddedCoords < start)":"paddedCoords < start",l=i>1?"any(paddedCoords >= end)":"paddedCoords >= end",d=i>1?["coords[0]","coords[1]","coords[2]","coords[3]"].slice(0,i):"coords";return`
        let start = ${o};
        let end = ${n};
        if (${u} || ${l}) {
          setOutputAtIndex(index, ${t?0:"uniforms.constantValue"});
        } else {
          let coords = paddedCoords - start;
          setOutputAtIndex(index, getX(${d}));
        }
  `}class sr{constructor(e,t){this.variableNames=["x"],this.uniforms="constantValue : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t.map((t,i)=>t[0]+e[i]+t[1]),this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),t.map((e,t)=>{this.uniforms+=` pad${t} : vec2<i32>,`}),this.xShape=e,this.shaderKey="pad"}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let paddedCoords = getCoordsFromIndex(index);
          ${si(this.xShape)}
        }
      }
    `}}let sa={kernelName:d.PadV2,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{paddings:s,constantValue:o}=r;if(s.every(e=>d.util.arraysEqual(e,[0,0])))return eq({inputs:{x:a},backend:i});if(0===d.util.sizeFromShape(a.shape))return eO({backend:i,attrs:{shape:s.map((e,t)=>e[0]+a.shape[t]+e[1]),value:o,dtype:a.dtype}});let n=[{type:"float32",data:[o]}];s.map(e=>n.push({type:"int32",data:[e[0],e[1]]}));let u=new sr(a.shape,s);return i.runWebGPUProgram(u,[a],a.dtype,n)}},ss=e2({opType:o.POW}),so={kernelName:d.Pow,backendName:"webgpu",kernelFunc:ss},sn={kernelName:d.Prelu,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{x:r,alpha:a}=t,s=new eK(o.PRELU,r.shape,a.shape);return i.runWebGPUProgram(s,[r,a],"float32")}},su={kernelName:d.Prod,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{axis:s,keepDims:o}=r;return tM(a,s,o,"prod",i)}},sl={kernelName:d.Range,backendName:"webgpu",kernelFunc:e=>{let{backend:t,attrs:i}=e,{start:r,stop:a,step:s,dtype:o}=i,n=tf(r,a,s,o);return t.makeTensorInfo([n.length],o,n)}},sd=e2({opType:o.DIV}),sh={kernelName:d.RealDiv,backendName:"webgpu",kernelFunc:sd},sp=eJ({opType:n.RECIPROCAL}),sc={kernelName:d.Reciprocal,backendName:"webgpu",kernelFunc:sp},sf=eJ({opType:n.RELU}),sm={kernelName:d.Relu,backendName:"webgpu",kernelFunc:sf},sg=eJ({opType:n.RELU6}),sx={kernelName:d.Relu6,backendName:"webgpu",kernelFunc:sg};class sy{constructor(e,t,i){this.variableNames=["x"],this.uniforms="adjustHeightWidth : vec2<f32>, halfPixelCenters : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e[0],t,i,e[3]],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="resizeBilinear"}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
        let coords = getCoordsFromIndex(index);
          let b = coords[0];
          let d = coords[3];
          let rc = coords.yz;

          let effectiveInSize = vec2<f32>(
            f32(uniforms.xShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.xShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveOutSize = vec2<f32>(
            f32(uniforms.outShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.outShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveInputOverOutputRatioRC =
              effectiveInSize / effectiveOutSize;

          // Fractional source index
          let sourceFracIndexRC =
            (vec2<f32>(rc) + vec2<f32>(uniforms.halfPixelCenters)) *
            effectiveInputOverOutputRatioRC - vec2<f32>(uniforms.halfPixelCenters);

          // Compute the four integer indices.
          let sourceFloorRC = vec2<i32>(sourceFracIndexRC);
          let sourceCeilRC = vec2<i32>(
            min(vec2<f32>(uniforms.xShape.yz) - vec2<f32>(1.0), ceil(sourceFracIndexRC)));

          let topLeft = getX(b, sourceFloorRC.x, sourceFloorRC.y, d);
          let bottomLeft = getX(b, sourceCeilRC.x, sourceFloorRC.y, d);
          let topRight = getX(b, sourceFloorRC.x, sourceCeilRC.y, d);
          let bottomRight = getX(b, sourceCeilRC.x, sourceCeilRC.y, d);

          let fracRC = sourceFracIndexRC - vec2<f32>(sourceFloorRC);

          let top = topLeft + (topRight - topLeft) * fracRC.y;
          let bottom = bottomLeft + (bottomRight - bottomLeft) * fracRC.y;
          let newValue = top + (bottom - top) * fracRC.x;

          setOutputAtIndex(index, newValue);
        }
      }
    `}}let sw={kernelName:d.ResizeBilinear,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a}=t,{alignCorners:s,size:o,halfPixelCenters:n}=r,[u,l]=o,d=s&&u>1?1:0,h=s&&l>1?1:0,p=new sy(a.shape,u,l);return i.runWebGPUProgram(p,[a],"float32",[{type:"float32",data:[d,h]},{type:"float32",data:[n?.5:0]}])}};class sb{constructor(e,t){this.variableNames=["dy"],this.uniforms=`effectiveXSize : vec2<i32>, effectiveYSize : vec2<i32>, heightScale : f32, widthScale : f32,
       invHeightScale : f32, invWidthScale : f32, winHeight : i32, winWidth : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.alignCorners=t,this.shaderKey=`resizeBilinearBackprop_${t}`}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let b = coords[0];
          let d = coords[3];
          let r = coords[1];
          let c = coords[2];

          var accumulator = 0.0;

          // Compute bounds for where in dy we will look
          let startRLerp = floor(f32(r) * uniforms.invHeightScale);
          let startDyR = i32(startRLerp - f32(uniforms.winHeight / 2));

          let startCLerp = floor(f32(c) * uniforms.invWidthScale);
          let startDyC = i32(startCLerp - f32(uniforms.winWidth / 2));

          // Loop over dy
          for (var dyROffset = 0; dyROffset < uniforms.winHeight; dyROffset++) {
            let dyR = startDyR + dyROffset;

            // Guard against the window exceeding the bounds of dy
            if (dyR < 0 || dyR >= uniforms.dyShape[1]) {
              continue;
            }

            for (var dyCOffset = 0; dyCOffset < uniforms.winWidth; dyCOffset++) {
              let dyC = startDyC + dyCOffset;

              // Guard against the window exceeding the bounds of dy
              if (dyC < 0 || dyC >= uniforms.dyShape[2]) {
                continue;
              }

              let dxR = f32(dyR) * uniforms.heightScale;
              let topDxRIndex = i32(floor(dxR));
              let bottomDxRIndex = i32(min(ceil(dxR), f32(uniforms.outShape[1] - 1)));
              let dxRLerp = dxR - f32(topDxRIndex);
              let inverseDxRLerp = 1.0 - dxRLerp;

              let dxC = f32(dyC) * uniforms.widthScale;
              let leftDxCIndex = i32(floor(dxC));
              let rightDxCIndex = i32(min(ceil(dxC), f32(uniforms.outShape[2] - 1)));
              let dxCLerp = dxC - f32(leftDxCIndex);
              let inverseDxCLerp = 1.0 - dxCLerp;

              if (r == topDxRIndex && c == leftDxCIndex) {
                // topLeft
                accumulator +=
                  getDy(b, dyR, dyC, d) * inverseDxRLerp * inverseDxCLerp;
              }

              if (r == topDxRIndex && c == rightDxCIndex) {
                // topRight
                accumulator += getDy(b, dyR, dyC, d) * inverseDxRLerp * dxCLerp;
              }

              if (r == bottomDxRIndex && c == leftDxCIndex) {
                // bottomLeft
                accumulator += getDy(b, dyR, dyC, d) * dxRLerp * inverseDxCLerp;
              }

              if (r == bottomDxRIndex && c == rightDxCIndex) {
                // bottomRight
                accumulator += getDy(b, dyR, dyC, d) * dxRLerp * dxCLerp;
              }
            }
          }
          // End loop over dy

          setOutputAtIndex(index, accumulator);
        }
      }
    `}}let sC={kernelName:d.ResizeBilinearGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a,dy:s}=t,{alignCorners:o}=r,[,n,u]=a.shape,[,l,d]=s.shape,h=[o&&l>1?n-1:n,o&&d>1?u-1:u],p=[o&&l>1?l-1:l,o&&d>1?d-1:d],c=h[0]/p[0],f=h[1]/p[1],m=1/c,g=1/f,x=new sb(a.shape,o);return i.runWebGPUProgram(x,[s],s.dtype,[{type:"int32",data:h},{type:"int32",data:p},{type:"float32",data:[c]},{type:"float32",data:[f]},{type:"float32",data:[m]},{type:"float32",data:[g]},{type:"int32",data:[2*Math.ceil(m)+2]},{type:"int32",data:[2*Math.ceil(g)+2]}])}};class sS{constructor(e,t,i,r){this.variableNames=["x"],this.uniforms="adjustHeightWidth : vec2<f32>, roundBase : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=[e[0],t,i,e[3]],this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.halfPixelCenters=r,this.shaderKey=`resizeNearest_${r}`}getUserCode(){let e;return e=this.halfPixelCenters?"max((vec2<f32>(rc) + vec2<f32>(0.5)) * effectiveInputOverOutputRatioRC, vec2<f32>(0.0))":"vec2<f32>(rc) * effectiveInputOverOutputRatioRC",`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let b = coords[0];
          let d = coords[3];
          let rc = coords.yz;

          let effectiveInSize = vec2<f32>(
            f32(uniforms.xShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.xShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveOutSize = vec2<f32>(
            f32(uniforms.outShape.y) - uniforms.adjustHeightWidth[0],
            f32(uniforms.outShape.z) - uniforms.adjustHeightWidth[1]);

          let effectiveInputOverOutputRatioRC =
              effectiveInSize / effectiveOutSize;

          // Fractional source index
          let sourceFracIndexRC = ${e};

          // Compute the coordinators of nearest neighbor point.
          let inputShapeRC = vec2<f32>(f32(uniforms.xShape.y), f32(uniforms.xShape.z));
          let sourceNearestRC = vec2<i32>(
            min(inputShapeRC - 1.0, floor(sourceFracIndexRC + uniforms.roundBase)));
          let newValue = getX(b, sourceNearestRC.x, sourceNearestRC.y, d);

          setOutputAtIndex(index, newValue);
        }
      }
    `}}let sv={kernelName:d.ResizeNearestNeighbor,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a}=t,{alignCorners:s,halfPixelCenters:o,size:n}=r,[u,l]=n,d=s&&u>1?1:0,h=s&&l>1?1:0,p=new sS(a.shape,u,l,o);return i.runWebGPUProgram(p,[a],a.dtype,[{type:"float32",data:[d,h]},{type:"float32",data:[s?.5:0]}])}};class sI{constructor(e,t){this.variableNames=["dy"],this.uniforms=`effectiveXSize : vec2<i32>, effectiveYSize : vec2<i32>, invHeightScale : f32, invWidthScale : f32,
       winHeight : i32, winWidth : i32,`,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.alignCorners=t,this.shaderKey=`resizeNearestNeigborBackprop_${t}`}getUserCode(){return`
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getOutputCoords();
          let b = coords[0];
          let d = coords[3];
          let r = coords[1];
          let c = coords[2];

          var accumulator = 0.0;

          // Compute bounds for where in dy we will look
          let startRLerp = floor(f32(r) * uniforms.invHeightScale);
          let startDyR = i32(floor(startRLerp - f32(uniforms.winHeight / 2)));

          let startCLerp = floor(f32(c) * uniforms.invWidthScale);
          let startDyC = i32(floor(startCLerp - f32(uniforms.winWidth / 2)));

          // Loop over dy
          for (var dyROffset = 0; dyROffset < uniforms.winHeight; dyROffset++) {
            let dyR = startDyR + dyROffset;

            // Guard against the window exceeding the bounds of dy
            if (dyR < 0 || dyR >= uniforms.dyShape[1]) {
              continue;
            }

            for (var dyCOffset = 0; dyCOffset < uniforms.winWidth; dyCOffset++) {
              let dyC = startDyC + dyCOffset;

              // Guard against the window exceeding the bounds of dy
              if (dyC < 0 || dyC >= uniforms.dyShape[2]) {
                continue;
              }

              let sourceFracRow = f32(uniforms.effectiveXSize[0]) *
                  (f32(dyR) / f32(uniforms.effectiveYSize[0]));

              let sourceFracCol = f32(uniforms.effectiveXSize[1]) *
                  (f32(dyC) / f32(uniforms.effectiveYSize[1]));

              let sourceNearestRow =
                  i32(min(f32(uniforms.outShape[1] - 1),
                  ${this.alignCorners?"floor(sourceFracRow + 0.5)":"floor(sourceFracRow)"}));

              let sourceNearestCol =
                  i32(min(f32(uniforms.outShape[2] - 1),
                  ${this.alignCorners?"floor(sourceFracCol + 0.5)":"floor(sourceFracCol)"}));

              if (r == sourceNearestRow && c == sourceNearestCol) {
                accumulator += getDy(b, dyR, dyC, d);
              }
            }
          }
          // End loop over dy

          setOutputAtIndex(index, accumulator);
        }
      }
    `}}let sk={kernelName:d.ResizeNearestNeighborGrad,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{images:a,dy:s}=t,{alignCorners:o}=r,[,n,u]=a.shape,[,l,d]=s.shape,h=[o&&l>1?n-1:n,o&&d>1?u-1:u],p=[o&&l>1?l-1:l,o&&d>1?d-1:d],c=h[0]/p[0],f=h[1]/p[1],m=1/c,g=1/f,x=new sI(a.shape,o);return i.runWebGPUProgram(x,[s],s.dtype,[{type:"int32",data:h},{type:"int32",data:p},{type:"float32",data:[m]},{type:"float32",data:[g]},{type:"int32",data:[2*Math.ceil(m)+2]},{type:"int32",data:[2*Math.ceil(g)+2]}])}};class sR{constructor(e){this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms=" axis : vec4<i32>,",this.shaderKey="reverse"}getUserCode(){let e=`
      // Using uniform variables as judging conditions, so the function has
      // coherent execution within all threads.
      fn getReverseCoords(coords : vec4<i32>) -> vec4<i32> {
        var reverseCoords = coords;
        if (uniforms.axis[0] == 1) {
          reverseCoords[0] = uniforms.xShape[0] - coords[0] - 1;
        }
        if (uniforms.axis[1] == 1) {
          reverseCoords[1] = uniforms.xShape[1] - coords[1] - 1;
        }
        if (uniforms.axis[2] == 1) {
          reverseCoords[2] = uniforms.xShape[2] - coords[2] - 1;
        }
        if (uniforms.axis[3] == 1) {
          reverseCoords[3] = uniforms.xShape[3] - coords[3] - 1;
        }

        return reverseCoords;
      }
    `;return`
      ${e}
      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let reverseCoords = getReverseCoords(coords);
          setOutputAtIndex(index, getX(reverseCoords[0],
              reverseCoords[1], reverseCoords[2], reverseCoords[3]));
        }
      }
    `}}let s$={kernelName:d.Reverse,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{dims:s}=r,o=a.shape.length;if(0===o)return eq({inputs:{x:a},backend:i});let n=a.shape,u=[1,1,1,1];n.forEach((e,t)=>{u[t+4-o]=e});let l=d.util.parseAxisParam(s,a.shape),h=[0,0,0,0];l.forEach(e=>{h[e+4-o]=1});let p=eV({inputs:{x:a},backend:i,attrs:{shape:u}}),c=new sR(u),f=i.runWebGPUProgram(c,[p],p.dtype,[{type:"int32",data:h}]);i.disposeData(p.dataId);let m=eV({inputs:{x:f},backend:i,attrs:{shape:n}});return i.disposeData(f.dataId),m}};class sP{constructor(e,t){this.outputShape=[],this.variableNames=["x"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms=`centerX : f32, centerY : f32, sinRadians : f32,
          cosRadians : f32,`,this.shaderKey="rotate",this.outputShape=e,"number"==typeof t?(this.uniforms+=" fillValue : f32,",this.fillSnippet="var outputValue = uniforms.fillValue;",this.shaderKey+="_float"):(this.uniforms+=" fillValue : vec3<f32>,",this.fillSnippet="var outputValue = uniforms.fillValue[coords[3]];",this.shaderKey+="_vec3")}getUserCode(){return`
        ${S("index")} {
          if (index < uniforms.size) {
            let coords = getCoordsFromIndex(index);
            let coordXFloat = (f32(coords[2]) - uniforms.centerX) *
                uniforms.cosRadians - (f32(coords[1]) - uniforms.centerY) *
                uniforms.sinRadians;
            let coordYFloat = (f32(coords[2]) - uniforms.centerX) *
                uniforms.sinRadians + (f32(coords[1]) - uniforms.centerY) *
                uniforms.cosRadians;
            let coordX = i32(round(coordXFloat + uniforms.centerX));
            let coordY = i32(round(coordYFloat + uniforms.centerY));
            ${this.fillSnippet}
            if(coordX >= 0 && coordX < uniforms.xShape[2] && coordY >= 0 &&
                coordY < uniforms.xShape[1]) {
              outputValue = getX(coords[0], coordY, coordX, coords[3]);
            }
            setOutputAtIndex(index, outputValue);
          }
        }
      `}}let sz={kernelName:d.RotateWithOffset,backendName:"webgpu",kernelFunc:({inputs:e,attrs:t,backend:i})=>{let{image:r}=e,{radians:a,fillValue:s,center:o}=t,n=new sP(r.shape,s),[u,l]=d.backend_util.getImageCenter(o,r.shape[1],r.shape[2]),h=[{type:"float32",data:[u]},{type:"float32",data:[l]},{type:"float32",data:[Math.sin(a)]},{type:"float32",data:[Math.cos(a)]}];return"number"==typeof s?h.push({type:"float32",data:[Number.parseFloat(s.toFixed(2))]}):h.push({type:"float32",data:s}),i.runWebGPUProgram(n,[r],r.dtype,h)}},sN=eJ({opType:n.ROUND}),sA={kernelName:d.Round,backendName:"webgpu",kernelFunc:sN},sD=eJ({opType:n.RSQRT,cpuKernelImpl:tm}),sF={kernelName:d.Rsqrt,backendName:"webgpu",kernelFunc:sD};class s_{constructor(e,t,i,r,a,s,o,n=!0){this.variableNames=["updates","indices"],this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=s,this.type=o,this.sumDupeIndices=n,this.dispatchLayout=L(e),this.dispatch=D(this.dispatchLayout,e,this.workgroupSize),this.sliceDimGreaterThanOne=t>1,this.shaderKey=`scatter_${i}_${r}_${this.sliceDimGreaterThanOne}_${o}_${n}_${a.length}`;let u=b(a.length);this.uniforms=`sliceDim : i32, strides: ${u}, updatesSize: i32,`,this.updatesRank=r,this.indicesRank=i}getUserCode(){let e="";1===this.indicesRank?e="coords[0]":2===this.indicesRank&&(e="coords[0], j");let t=`getIndices(${e})`,i=this.sliceDimGreaterThanOne?"uniforms.strides[j]":"uniforms.strides",r="",a="";1===this.dispatchLayout.x.length?(r="flattenedIndex",a=`
      fn getUpdatesCoordsFromFlatIndex(index : i32) -> i32 {
        return index;
      }
      `):2===this.dispatchLayout.x.length&&(r="vec2<i32>(flattenedIndex, coords[1])",a=`
      fn getUpdatesCoordsFromFlatIndex(index : i32) -> vec2<i32> {
        // N.B. |updates| could be a scalar tensor, conceptually representing a
        // 2D tensor with all values equal to that. By design, its size must be
        // the same as |outShape[1]| in one dimension, and |indicesShape[0]|
        // gives the other.
        let sliceSize = uniforms.outShape[1];
        let d0 = index / sliceSize;
        let d1 = index - d0 * sliceSize;
        return vec2<i32>(d0, d1);
      }
      `);let s=Array.from({length:this.updatesRank},(e,t)=>`coords[${t}]`),o=`getUpdates(${s.join(", ")})`;return`
    ${a}
      ${S("index")} {
        if (index < uniforms.updatesSize) {
          let coords = getUpdatesCoordsFromFlatIndex(index);
          var flattenedIndex = 0;
          for (var j = 0; j < uniforms.sliceDim; j = j + 1) {
            let indexInside = i32(round(${t}));
            flattenedIndex = flattenedIndex + indexInside * ${i};
          }
          let updateValue =
              ${P(this.type)}(${o});
          let flatIndex = getOutputIndexFromCoords(${r});

          ${this.sumDupeIndices?x("&result[flatIndex]","updateValue",this.type):"atomicStore(&result[flatIndex], bitcast<i32>(updateValue));"}
        }
      }`}}let sT={kernelName:d.ScatterNd,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{indices:a,updates:s}=t,{shape:o}=r,{sliceRank:n,numUpdates:u,sliceSize:l,strides:h,outputSize:p}=d.backend_util.calculateShapes(s,a,o),c=[p/l,l];if(0===p)return i.makeTensorInfo(o,a.dtype);let f=eV({inputs:{x:a},backend:i,attrs:{shape:[u,n]}}),m=eV({inputs:{x:s},backend:i,attrs:{shape:[u,l]}}),g=m.dtype,x=eO({backend:i,attrs:{shape:c,value:0,dtype:g}}),y=[{type:"int32",data:[n]},{type:"int32",data:h},{type:"int32",data:[d.util.sizeFromShape(m.shape)]}],w=new s_(m.shape,n,f.shape.length,m.shape.length,h,c,g),b=i.runWebGPUProgram(w,[m,f],g,y,x),C=eV({inputs:{x:b},backend:i,attrs:{shape:o}});return i.disposeData(f.dataId),i.disposeData(m.dataId),i.disposeData(b.dataId),C}};class sL{constructor(e,t){this.outputShape=[],this.variableNames=["sortedSequence","values"],this.uniforms="numInputs : i32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.side=t,this.shaderKey=`search_sorted_${t}`}getUserCode(){let e="left"===this.side?"<":"<=";return`
      fn findBound(batch: i32, value: f32) -> i32 {
        var left = i32(0);
        var right = uniforms.numInputs;
        while (left < right) {
          var mid = (left + right) / 2;
          if (getSortedSequence(batch, mid) ${e} value) {
            left = mid + 1;
          } else {
            right = mid;
          }
        }
        return right;
      }

      ${S("index")} {
        if (index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let value = getValuesByOutputIndex(index);
          setOutputAtIndexI32(index, findBound(coords[0], value));
        }
      }
    `}}let sE={kernelName:d.SearchSorted,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{sortedSequence:a,values:s}=t,{side:o}=r,n=new sL([s.shape[0],s.shape[1]],o),u=[{type:"int32",data:[a.shape[1]]}];return i.runWebGPUProgram(n,[a,s],"int32",u)}};class sB{constructor(e,t,i){this.variableNames=["c","a","b"],this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=t,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.cRank=e,this.rank=i,this.shaderKey="select"}getUserCode(){let e,t;if(this.rank>4)throw Error(`Where for rank ${this.rank} is not yet supported`);if(1===this.rank)t="resRC",e="resRC";else{let i=["resRC.x","resRC.y","resRC.z","resRC.w"],r=[],a=[];for(let e=0;e<this.outputShape.length;e++)a.push(`${i[e]}`),e<this.cRank&&r.push(`${i[e]}`);e=r.join(),t=a.join()}return`
      ${S("index")} {
        if (index < uniforms.size) {
          let resRC = getCoordsFromIndex(index);
          let cVal = getC(${e});
          if (cVal >= 1.0) {
            setOutputAtIndex(index, getA(${t}));
          } else {
            setOutputAtIndex(index, getB(${t}));
          }
        }
      }
    `}}let sW={kernelName:d.Select,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{condition:r,t:a,e:s}=t,o=new sB(r.shape.length,a.shape,a.shape.length);return i.runWebGPUProgram(o,[r,a,s],(0,d.upcastType)(a.dtype,s.dtype))}},sO=eJ({opType:n.SELU}),sU={kernelName:d.Selu,backendName:"webgpu",kernelFunc:sO},sV=eJ({opType:n.SIGMOID}),sM={kernelName:d.Sigmoid,backendName:"webgpu",kernelFunc:sV},sG=eJ({opType:n.SIGN}),sH={kernelName:d.Sign,backendName:"webgpu",kernelFunc:sG},sX=eJ({opType:n.SIN}),sK={kernelName:d.Sin,backendName:"webgpu",kernelFunc:sX},sq=eJ({opType:n.SINH}),sY={kernelName:d.Sinh,backendName:"webgpu",kernelFunc:sq},sj=eJ({opType:n.SOFTPLUS}),sQ={kernelName:d.Softplus,backendName:"webgpu",kernelFunc:sj};class sZ{constructor(e,t,i,r,a,s){this.variableNames=["x"],this.outputShape=[],this.uniforms="",this.workgroupSize=[64,1,1],this.size=!0;let o=Array(r.length);for(let e=0;e<o.length;e++)o[e]=r[a[e]];this.outputShape=o,this.newDim=a,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.xShape=e,this.paddedXShape=t,this.uniforms+=`reshapedPaddedXShape : ${b(r.length)}, paddedXShapeStrides : ${b(s)}, `,i.map((e,t)=>{this.uniforms+=` pad${t} : vec2<i32>,`}),this.shaderKey=`spaceToBatchND_${a}`}getUserCode(){let e=b(this.outputShape.length),t=tB(this.newDim);return`
      ${R(this.paddedXShape,"PaddedX")}
      ${S("index")} {
        if(index < uniforms.size) {
          let coords = getCoordsFromIndex(index);
          let switchedIndex = getIndexFromCoords${this.outputShape.length}D(${e}(${t}), uniforms.reshapedPaddedXShape);
          let paddedCoords = getPaddedXCoordsFromIndex(switchedIndex);
          ${si(this.xShape,!0)}
        }
      }
    `}}let sJ={kernelName:d.SpaceToBatchND,backendName:"webgpu",kernelFunc:e=>{let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{blockShape:s,paddings:o}=r;d.util.assert(a.shape.length<=4,()=>"spaceToBatchND for rank > 4 with a WebGPU backend not implemented yet");let n=s.reduce((e,t)=>e*t),u=[[0,0]];u.push(...o);for(let e=1+s.length;e<a.shape.length;++e)u.push([0,0]);let l=u.map((e,t)=>e[0]+a.shape[t]+e[1]),h=d.backend_util.getReshaped(l,s,n,!1),p=d.backend_util.getPermuted(h.length,s.length,!1),c=d.backend_util.getReshapedPermuted(l,s,n,!1),f=d.util.computeStrides(l),m=new sZ(a.shape,l,u,h,p,f.length),g=[{type:"int32",data:h},{type:"int32",data:f}];u.map(e=>g.push({type:"int32",data:[e[0],e[1]]}));let x=i.runWebGPUProgram(m,[a],a.dtype,g),y=eV({inputs:{x:x},backend:i,attrs:{shape:c}});return i.disposeData(x.dataId),y}};class s2{constructor(e,t,i){this.variableNames=["input","indices","segmentIds"],this.outputShape=[],this.uniforms="segmentSize : i32, sparseSize : i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=e,this.type=i,this.dispatchLayout=L([t]),this.dispatch=D(this.dispatchLayout,[t],this.workgroupSize),this.shaderKey="sparseSegmentSum"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.sparseSize) {
        let indexInSegmentIds = index / uniforms.segmentSize;
        let indexInSegment = index % uniforms.segmentSize;
        let indexInInput = indices[indexInSegmentIds];
        let segmentId = segmentIds[indexInSegmentIds];

        let value = input[indexInInput * uniforms.segmentSize + indexInSegment];
        let outIndex = segmentId * uniforms.segmentSize + indexInSegment;
        ${x("&result[outIndex]","value",this.type)}
      }
    }
  `}}class s3{constructor(e,t){this.variableNames=["segmentIds"],this.outputShape=[],this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=[e],this.dispatchLayout=L(t),this.dispatch=D(this.dispatchLayout,t,this.workgroupSize),this.shaderKey="sparseSegmentIdCountProgram"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.segmentIdsShape) {
        let segmentId = segmentIds[index];
        ${x("&result[segmentId]","1","int32")}
      }
    }
  `}}class s0{constructor(e,t){this.variableNames=["segmentSum","sameSegmentIdCount"],this.outputShape=[],this.uniforms="segmentSize : i32",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.type=t,this.dispatchLayout=L(e),this.dispatch=D(this.dispatchLayout,e,this.workgroupSize),this.shaderKey="sparseSegmentMean"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.size) {
        let segmentId = index / uniforms.segmentSize;
        let count = sameSegmentIdCount[segmentId];
        if (count != 0) {
          ${"float32"===this.type?"setOutputAtIndex(index, segmentSum[index] / f32(count));":"setOutputAtIndexI32(index, segmentSum[index] / count);"}
        }
      }
    }
  `}}function s1(e,t,i,r=!1,a){let s;let o=d.util.sizeFromShape(e.shape)/e.shape[0],n=e.dtype,u=d.util.sizeFromShape(t.shape),l=a.readSync(i.dataId),h=u>0?l[u-1]+1:0,p=e.shape.slice();p[0]=h;let c=u*o,f=eO({backend:a,attrs:{shape:p,value:0,dtype:n}});s=new s2(p,c,n);let m=[{type:"int32",data:[o]},{type:"int32",data:[c]}],g=a.runWebGPUProgram(s,[e,t,i],n,m,f);if(r)return g;let x=eO({backend:a,attrs:{shape:[h],value:0,dtype:"int32"}});s=new s3(h,i.shape);let y=a.runWebGPUProgram(s,[i],"int32",null,x),w=eO({backend:a,attrs:{shape:p,value:0,dtype:n}});s=new s0(p,n),m=[{type:"int32",data:[o]}];let b=a.runWebGPUProgram(s,[g,y],n,m,w);return a.disposeData(g.dataId),a.disposeData(y.dataId),b}let s4={kernelName:d.SparseSegmentMean,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{data:r,indices:a,segmentIds:s}=t;return s1(r,a,s,!1,i)}},s6={kernelName:d.SparseSegmentSum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i}=e,{data:r,indices:a,segmentIds:s}=t;return s1(r,a,s,!0,i)}};class s5{constructor(e,t){this.variableNames=["A"],this.workgroupSize=[64,1,1],this.size=!0;let i=Array(e.length);for(let r=0;r<i.length;r++)i[r]=e[r]*t[r];this.outputShape=i,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.rank=this.outputShape.length,this.shaderKey="tile"}getUserCode(){let e=function(e,t=""){if(e>=5)throw Error(`Tile for rank ${e} is not yet supported`);if(1===e)return`(resRC % ${t}aShape)`;let i=["resRC.x","resRC.y","resRC.z","resRC.w"],r=[];for(let a=0;a<e;a++)r.push(`(${i[a]} % ${t}aShape[${a}])`);return r.join()}(this.rank,"uniforms.");return`
      ${S("index")} {
        if (index < uniforms.size) {
          let resRC = getCoordsFromIndex(index);
          setOutputAtIndex(index, getA(${e}));
        }
      }
    `}}function s8(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{reps:s}=r;if(i.shouldExecuteOnCPU([a])||"string"===a.dtype||a.shape.length>=5){let e=i.readSync(a.dataId),t="string"===a.dtype?e.map(e=>d.util.decodeString(e)):e,r=tS((0,d.buffer)(a.shape,a.dtype,t),s);return i.makeTensorInfo(r.shape,r.dtype,r.values)}let o=new s5(a.shape,s);return i.runWebGPUProgram(o,[a],a.dtype)}let s9={kernelName:d.Tile,backendName:"webgpu",kernelFunc:s8},s7={kernelName:d.SparseToDense,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{sparseIndices:a,sparseValues:s,defaultValue:o}=t,{outputShape:n}=r,{sliceRank:u,numUpdates:l,sliceSize:h,strides:p,outputSize:c}=d.backend_util.calculateShapes(s,a,n);if("string"===s.dtype){let e=tg(i.bufferSync(a),i.bufferSync(s),n,c,h,l,u,p,d.util.decodeString(i.readSync(o.dataId)[0]),!1);return i.makeTensorInfo(n,e.dtype,e.values)}let f=[c/h,h],m=eV({inputs:{x:a},backend:i,attrs:{shape:[l,u]}}),g=s.shape.length?eV({inputs:{x:s},backend:i,attrs:{shape:[l,h]}}):eq({inputs:{x:s},backend:i}),x=g.dtype,y=i.makeTensorInfo([],x,d.util.makeZerosTypedArray(1,x)),w=eV({inputs:{x:o},backend:i,attrs:{shape:Array(f.length).fill(1)}}),b=s8({inputs:{x:w},backend:i,attrs:{reps:f}}),C=[{type:"int32",data:[u]},{type:"int32",data:p},{type:"int32",data:[d.util.sizeFromShape([l,h])]}];switch(l){case 0:break;case 1:{let e=new s_([l,h],u,m.shape.length,g.shape.length,p,f,x,!1);i.runWebGPUProgram(e,[g,m],x,C,b)}break;default:{let e=new s_([l,h],u,m.shape.length,y.shape.length,p,f,x,!1);i.runWebGPUProgram(e,[y,m],x,C,b)}{let e=new s_([l,h],u,m.shape.length,g.shape.length,p,f,x);i.runWebGPUProgram(e,[g,m],x,C,b)}}let S=eV({inputs:{x:b},backend:i,attrs:{shape:n}});return i.disposeData(m.dataId),i.disposeData(g.dataId),i.disposeData(w.dataId),i.disposeData(y.dataId),i.disposeData(b.dataId),S}},oe={kernelName:d.SplitV,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{numOrSizeSplits:s,axis:o}=r,n=d.util.parseAxisParam(o,a.shape)[0],u=d.backend_util.prepareSplitSize(a,s,n),l=Array(a.shape.length).fill(0),h=a.shape.slice();return u.map(e=>{let t=[...h];t[n]=e;let r=ic({inputs:{x:a},backend:i,attrs:{begin:l,size:t}});return l[n]+=e,r})}},ot=eJ({opType:n.SQRT}),oi={kernelName:d.Sqrt,backendName:"webgpu",kernelFunc:ot},or={kernelName:d.Square,backendName:"webgpu",kernelFunc:({inputs:e,backend:t})=>{let{x:i}=e,r=new eZ(i.shape,n.SQUARE);return t.runWebGPUProgram(r,[i],i.dtype)}},oa=e2({opType:o.SQUARED_DIFFERENCE}),os={kernelName:d.SquaredDifference,backendName:"webgpu",kernelFunc:oa},oo={kernelName:d.Step,backendName:"webgpu",kernelFunc:function({inputs:e,attrs:t,backend:i}){let{x:r}=e,a=new eZ(r.shape,n.STEP,"stepAlpha : f32,"),s=[{type:"float32",data:[t.alpha]}];return i.runWebGPUProgram(a,[r],r.dtype,s)}};class on{constructor(e){this.variableNames=["x"],this.workPerThread=1,this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize,[this.workPerThread,1,1]);let t=b(this.outputShape.length);this.uniforms=`begin : ${t},  strides : ${t}, `,this.shaderKey="stridedSlice"}getUserCode(){let e=this.outputShape.length,t="";if(1===e)t="coords * uniforms.strides + uniforms.begin";else{let e=0;t=this.outputShape.map((t,i)=>(e++,1===this.outputShape.length?`coords * uniforms.strides[${i}] + uniforms.begin[${i}]`:`coords[${e-1}] * uniforms.strides[${i}] + uniforms.begin[${i}]`)).join(",")}return`
       ${S("index")} {
         if (index < uniforms.size) {
           let coords = getCoordsFromIndex(index);
           setOutputAtIndex(index, getX(${t}));
         }
       }
     `}}let ou={kernelName:d.StridedSlice,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{x:s}=i,{begin:o,end:n,strides:u,beginMask:l,endMask:h,ellipsisMask:p,newAxisMask:c,shrinkAxisMask:f}=a,{finalShapeSparse:m,finalShape:g,isIdentity:x,sliceDim0:y,isSimpleSlice:w,begin:b,end:C,strides:S}=d.slice_util.sliceInfo(s.shape,o,n,u,l,h,p,c,f);if(x)t=eV({inputs:{x:s},backend:r,attrs:{shape:g}});else if(y||w){d.util.assert(s.shape.length>=1,()=>`Input must have rank at least 1, got: ${s.shape.length}`);let e=d.slice_util.computeOutShape(b,C,S),i=ic({inputs:{x:s},backend:r,attrs:{begin:b,size:e}});t=eV({inputs:{x:i},backend:r,attrs:{shape:g}}),r.disposeData(i.dataId)}else if(r.shouldExecuteOnCPU([s])){let e=r.readSync(s.dataId),i=tw(m,(0,d.buffer)(s.shape,s.dtype,e),S,b);t=r.makeTensorInfo(g,s.dtype,i.values)}else{let e=new on(m),i=[{type:"int32",data:b},{type:"int32",data:S}],a=r.runWebGPUProgram(e,[s],s.dtype,i);t=eV({inputs:{x:a},backend:r,attrs:{shape:g}}),r.disposeData(a.dataId)}return t}},ol={kernelName:d.StringNGrams,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{separator:a,nGramWidths:s,leftPad:o,rightPad:n,padWidth:u,preserveShortSequences:l}=r,{data:d,dataSplits:h}=t,[p,c]=tb(i.readSync(d.dataId),i.readSync(h.dataId),a,s,o,n,u,l);return[i.makeTensorInfo([p.length],"string",p),i.makeTensorInfo(h.shape,"int32",c)]}},od=e2({opType:o.SUB,cpuKernelImpl:tC,supportsComplex:!0}),oh={kernelName:d.Sub,backendName:"webgpu",kernelFunc:od},op=eJ({opType:n.TAN}),oc={kernelName:d.Tan,backendName:"webgpu",kernelFunc:op},of=eJ({opType:n.TANH}),om={kernelName:d.Tanh,backendName:"webgpu",kernelFunc:of},og={kernelName:d.TensorScatterUpdate,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{tensor:a,indices:s,updates:o}=t,{}=r,{sliceRank:n,numUpdates:u,sliceSize:l,strides:h,outputSize:p}=d.backend_util.calculateShapes(o,s,a.shape),c=[p/l,l];if(0===p)return i.makeTensorInfo(a.shape,s.dtype);let f=[],m=eV({inputs:{x:s},backend:i,attrs:{shape:[u,n]}});f.push(m);let g=eV({inputs:{x:o},backend:i,attrs:{shape:[u,l]}});f.push(g);let x=eV({inputs:{x:a},backend:i,attrs:{shape:c}});f.push(x);let y=s8({inputs:{x:x},backend:i,attrs:{reps:Array(c.length).fill(1)}}),w=new s_([u,l],n,m.shape.length,g.shape.length,h,c,a.dtype,!1),b=[{type:"int32",data:[n]},{type:"int32",data:h},{type:"int32",data:[d.util.sizeFromShape([u,l])]}],C=i.runWebGPUProgram(w,[g,m],x.dtype,b,y);f.push(C);let S=eV({inputs:{x:C},backend:i,attrs:{shape:a.shape}});return f.forEach(e=>i.disposeData(e.dataId)),S}};class ox{constructor(e){this.variableNames=["x","indices"],this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms=`inputSize : i32, firstPass : i32, negativeInf : f32,
        dir : i32, inc : i32,`,this.shaderKey="swap"}getUserCode(){return`
        ${S("index")} {
          if (index < uniforms.size) {
            let outC = getCoordsFromIndex(index);
            let batch = outC[0];
            let elemIdx = outC[1];
            // We compare elements pair-wise within a group of size 2 * inc.
            // The comparing rule for each group alternates between ascending
            // and descending. Within each group, we compare each pair at
            // positions i and i+inc. To decide whether an element at position i
            // is x0 or x1, we mod it by 2 * inc, if the result is smaller than
            // inc, it is in the first half of the group, we denote it as x0,
            // otherwise we denote it as x1.
            // For example, as shown in the Bitonic top K paper referenced
            // above, Figure5(a) shows that element[1] is in the second half of
            // the group when group size is 2, but it is in the first half of
            // the group when group size is 4.
            let isFirstInPair = elemIdx % (2 * uniforms.inc) < uniforms.inc;
            var i = 0;
            if (isFirstInPair) {
              i = elemIdx;
            } else {
              i = elemIdx - uniforms.inc;
            }

            var i0 = 0;
            if (uniforms.firstPass == 1) {
              i0 = i;
            } else {
              i0 = i32(getIndices(batch, i));
            }

            var i1 = 0;
            if (uniforms.firstPass == 1) {
              i1 = i + uniforms.inc;
            } else {
              i1 = i32(getIndices(batch, i + uniforms.inc));
            }

            var x0 = f32(0.0);
            var x1 = f32(0.0);
            if (i0 < uniforms.inputSize) {
              x0 = getX(batch, i0);
            } else {
              x0 = uniforms.negativeInf;
            }
            if (i1 < uniforms.inputSize) {
              x1 = getX(batch, i1);
            } else {
              x1 = uniforms.negativeInf;
            }

            let reverse = elemIdx % (2 * uniforms.dir) >= uniforms.dir;
            let isGreater = x0 > x1 || (x0 == x1 && i1 > i0);
            if (reverse == isGreater) {
              // Elements in opposite order of direction
              let iTemp = i0;
              i0 = i1;
              i1 = iTemp;
            }
            if (isFirstInPair) {
              setOutputAtIndex(index, f32(i0));
            } else {
              setOutputAtIndex(index, f32(i1));
            }
          }
        }
      `}}class oy{constructor(e){this.variableNames=["x","indices"],this.workgroupSize=[256,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.uniforms="inputSize : i32, firstPass : i32, k : i32,",this.shaderKey="merge"}getUserCode(){return`
        ${S("index")} {
          if (index < uniforms.size) {
            let outC = getCoordsFromIndex(index);
            let batch = outC[0];
            let elemIdx = outC[1];
            // The output size is half of the previous size.
            // If the previous sequence is | | | | _ _ _ _  | | | |  _ _ _ _
            // (k=4), we only need to output the indices at positions |, the
            // indices at positions _ can be thrown away, see Figure5(b) After
            // Phase 2 (Merge phase) in the Bitonic Top K paper referenced
            // above.
            // For example, the paper shows we only need to output the orange
            // bars. The output sequence should look like this | | | | | | | |.
            // Because the sequence is halved, to map the output index back to
            // the previous sequence to find the corresponding value, we need
            // to double the index. When we double the index, we basically
            // interpolate a position, so 2i looks like
            // | _ | _ | _ | _ | _ | _ | _. We move the | to the first k
            // position of each 2k positions by - elemIdx % k. E.g. for output
            // at index 4,5,6,7, we want to get the corresponding element at
            // original index 8,9,10,11, for output at index 8,9,10,11,
            // we want to get the corresponding element at original index
            // 16,17,18,19, so on and so forth.

            var i = 0;
            if (elemIdx < uniforms.k) {
              i = elemIdx;
            } else {
              i = elemIdx * 2 - elemIdx % uniforms.k;
            }
            var i0 = 0;
            if (uniforms.firstPass == 1) {
              i0 = i;
            } else {
              i0 = i32(getIndices(batch, i));
            }
            var i1 = 0;
            if (uniforms.firstPass == 1) {
              i1 = i + uniforms.k;
            } else {
              i1 = i32(getIndices(batch, i + uniforms.k));
            }

            let x0 = getX(batch, i0);
            var x1 = f32(0.0);
            if (i1 < uniforms.inputSize) {
              x1 = getX(batch, i1);
            } else {
              x1 = x0;
            }

            if (x0 >= x1) {
              setOutputAtIndex(index, f32(i0));
            } else {
              setOutputAtIndex(index, f32(i1));
            }
          }
        }
      `}}function ow(e,t){null!==t&&e.disposeData(t.dataId)}function ob(e){let t=1;for(;t<e;)t*=2;return t}let oC={kernelName:d.TopK,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a}=t,{k:s,sorted:o}=r,n=a.shape,u=n[n.length-1];if(i.shouldExecuteOnCPU([a])){let[e,t]=tv(i.readSync(a.dataId),n,a.dtype,s,o);return[i.makeTensorInfo(e.shape,e.dtype,e.values),i.makeTensorInfo(t.shape,t.dtype,t.values)]}if(0===s)return n[n.length-1]=0,[i.makeTensorInfo(n,a.dtype,[]),i.makeTensorInfo(n,"int32",[])];if(1===u)return[a,eO({attrs:{shape:n,dtype:"int32",value:0},backend:i})];let l=d.util.sizeFromShape(n)/u,h=eV({inputs:{x:a},attrs:{shape:[l,u]},backend:i}),p=ob(s),c=ob(u),f=null,m=()=>null===f?[h,h]:[h,f],g=(e,t,r)=>{let a=m(),s=new ox(r),o=[{type:"int32",data:[u]},{type:"int32",data:[null===f?1:0]},{type:"float32",data:[Number.NEGATIVE_INFINITY]},{type:"int32",data:[e]},{type:"int32",data:[t]}],n=f;f=i.runWebGPUProgram(s,a,"int32",o),ow(i,n)};for(let e=1;e<p;e*=2){let t=2*e;for(let i=e;i>=1;i/=2)g(t,i,[l,c])}for(let e=c;e>p;e/=2){let t=m(),r=new oy([l,e/2]),a=[{type:"int32",data:[u]},{type:"int32",data:[null===f?1:0]},{type:"int32",data:[p]}],s=f;f=i.runWebGPUProgram(r,t,"int32",a),ow(i,s);let o=p/2,n=2*o;for(let e=o;e>=1;e/=2)g(n,e,f.shape)}let x=f;f=ic({inputs:{x:f},backend:i,attrs:{begin:0,size:[l,s]}}),ow(i,x);let y=ae({inputs:{x:h,indices:f},backend:i,attrs:{axis:1,batchDims:1}});ow(i,h);let w=n.slice(0,-1);w.push(s),x=f,f=eV({inputs:{x:f},attrs:{shape:w},backend:i}),ow(i,x);let b=y;return y=eV({inputs:{x:y},attrs:{shape:w},backend:i}),ow(i,b),[y,f]}};class oS{constructor(e){this.variableNames=["Image","Transforms"],this.uniforms="interpolationModeId : i32, fillModeId : i32, fillValue : f32,",this.workgroupSize=[64,1,1],this.size=!0,this.outputShape=e,this.dispatchLayout=L(this.outputShape),this.dispatch=D(this.dispatchLayout,this.outputShape,this.workgroupSize),this.shaderKey="transform"}getUserCode(){return`
          fn mapCoord(outCoord : f32, len : f32) -> f32{
            var inCoord = outCoord;
            if(uniforms.fillModeId == 2) {
              if (inCoord < 0.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz2 = 2.0 * len;
                  if (inCoord < sz2) {
                    inCoord = sz2 * f32(i32(f32(-inCoord / sz2))) +
                    inCoord;
                  }
                  if (inCoord < -len) {
                    inCoord = inCoord + sz2;
                  } else {
                    inCoord = -inCoord - 1.0;
                  }
                }
              } else if (inCoord > len - 1.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz2 = 2.0 * len;
                  inCoord = inCoord - sz2 * f32(i32(f32(inCoord / sz2)));
                  if (inCoord >= len) {
                    inCoord = sz2 - inCoord - 1.0;
                  }
                }
              }
              return clamp(inCoord, 0.0, len - 1.0);
            } else if (uniforms.fillModeId == 3) {
              if (inCoord < 0.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz = len - 1.0;
                  inCoord = inCoord + len * (f32(i32(f32(-inCoord / sz))) + 1.0);
                }
              } else if (inCoord > len - 1.0) {
                if (len <= 1.0) {
                  inCoord = 0.0;
                } else {
                  let sz = len - 1.0;
                  inCoord = inCoord - len * f32(i32(f32(inCoord / sz)));
                }
              }
              return clamp(inCoord, 0.0, len - 1.0);
            } else if (uniforms.fillModeId == 4) {
              return clamp(outCoord, 0.0, len - 1.0);
            }
            return outCoord;
          }
          fn readWithFillValue(batch : i32, coordY : i32, coordX : i32,
            channel : i32) -> f32 {
            var outputValue : f32;
            if (0 <= coordY && coordY < uniforms.imageShape[1] && 0 <= coordX && coordX < uniforms.imageShape[2]) {
                outputValue = getImage(batch, coordY, coordX, channel);
            } else {
              outputValue = uniforms.fillValue;
            }
            return outputValue;
          }

          ${S("index")} {
            if (index < uniforms.size) {
              let coords = getCoordsFromIndex(index);
              var outputValue : f32;
              let batch = coords[0];
              let x = coords[2];
              let y = coords[1];
              let channel = coords[3];
              let xf = f32(x);
              let yf = f32(y);
              let a1 = getTransforms(batch, 0);
              let a2 = getTransforms(batch, 1);
              let a3 = getTransforms(batch, 2);
              let b1 = getTransforms(batch, 3);
              let b2 = getTransforms(batch, 4);
              let b3 = getTransforms(batch, 5);
              let c1 = getTransforms(batch, 6);
              let c2 = getTransforms(batch, 7);
              let projection = c1 * xf + c2 * yf + 1.0;
              if (projection == 0.0) {
                outputValue = uniforms.fillValue;
              } else {
                let inX = (a1 * xf + a2 * yf + a3) / projection;
                let inY = (b1 * xf + b2 * yf + b3) / projection;
                let mapX = mapCoord(inX, f32(uniforms.imageShape[2]));
                let mapY = mapCoord(inY, f32(uniforms.imageShape[1]));

                if (uniforms.interpolationModeId == 1) {
                  let coordY = i32(round(mapY));
                  let coordX = i32(round(mapX));
                  outputValue = readWithFillValue(batch, coordY, coordX,
                    channel);
                } else {
                  let yFloor = floor(mapY);
                  let xFloor = floor(mapX);
                  let yCeil = yFloor + 1.0;
                  let xCeil = xFloor + 1.0;
                  let valueYFloor = (xCeil - mapX) *
                  readWithFillValue(batch, i32(yFloor), i32(xFloor), channel) +
                  (mapX - xFloor) *
                  readWithFillValue(batch, i32(yFloor), i32(xCeil), channel);
                  let valueYCeil = (xCeil - mapX) *
                  readWithFillValue(batch, i32(yCeil), i32(xFloor), channel) +
                  (mapX - xFloor) *
                  readWithFillValue(batch, i32(yCeil), i32(xCeil), channel);
                  outputValue = (yCeil - mapY) * valueYFloor +
                  (mapY - yFloor) * valueYCeil;
                }
              }
              setOutputAtIndex(index, outputValue);
            }
          }
        `}}let ov={kernelName:d.Transform,backendName:"webgpu",kernelFunc:function(e){let t;let{inputs:i,backend:r,attrs:a}=e,{image:s,transforms:o}=i,{interpolation:n,fillMode:u,fillValue:l,outputShape:d}=a,[h,p,c,f]=s.shape,[m,g]=null!=d?d:[p,c],x=new oS([h,m,g,f]);switch(u){case"constant":default:t=1;break;case"reflect":t=2;break;case"wrap":t=3;break;case"nearest":t=4}let y=[{type:"int32",data:["nearest"===n?1:2]},{type:"int32",data:[t]},{type:"float32",data:[l]}];return r.runWebGPUProgram(x,[s,o],"float32",y)}},oI={kernelName:d.Unpack,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{value:a}=t,{axis:s}=r;s<0&&(s+=a.shape.length);let o=a.shape.length,n=a.shape[s],u=Array(o-1),l=0;for(let e=0;e<o;e++)e!==s&&(u[l++]=a.shape[e]);let d=[],h=Array(o).fill(0),p=a.shape.slice();p[s]=1;let c=Array(n);for(let e=0;e<c.length;e++){h[s]=e;let t=ic({inputs:{x:a},backend:i,attrs:{begin:h,size:p}}),r=eV({inputs:{x:t},backend:i,attrs:{shape:u}});c[e]=r,d.push(t)}return d.forEach(e=>i.disposeData(e.dataId)),c}};class ok{constructor(e,t,i){if(this.outputShape=[],this.variableNames=["x","segmentIds"],this.uniforms="numSegments : i32, xSize: i32,",this.workgroupSize=[64,1,1],this.atomic=!0,this.outputShape=t,this.dispatchLayout=L(e),this.dispatch=D(this.dispatchLayout,e,this.workgroupSize),"float32"!==i&&"int32"!==i)throw Error(`UnsortedSegmentSum only supports float32 and int32
              types, does not support ${i} type.`);this.type=i,this.shaderKey="unsortedSegmentSum"}getUserCode(){return`
    ${S("index")} {
      if (index < uniforms.xSize) {
        let coords = getXCoordsFromIndex(index);
        let b = coords[0];
        let inCol = coords[1];

        let segmentId = i32(getSegmentIds(inCol));
        if (segmentId >= 0) {
          let flatIndex = b * uniforms.numSegments + segmentId % uniforms.numSegments;
          let value = getX(b, inCol);

          ${x("&result[flatIndex]","value",this.type)}
        }
      }
    }
  `}}for(let e of[eH,t$,tz,tA,tF,tT,tG,tH,tK,tq,tj,tZ,t2,t0,t4,ir,ia,iu,il,id,ig,ib,iS,i$,iz,iD,eQ,iT,iO,iX,iQ,iJ,i3,i0,i1,i6,i8,i7,ra,rs,ro,ru,rm,rg,rp,ry,rb,rv,rI,rR,rA,rF,r_,rL,rB,rO,rV,rG,rK,eU,rY,r3,rQ,rJ,r4,r6,r5,r9,at,ar,as,eY,ao,iB,au,ad,ap,ac,am,ax,aw,av,aC,ak,a$,az,aF,aT,t7,aE,aB,aM,aW,aV,aG,it,aH,aK,aY,aQ,a0,rP,a1,a4,a6,iI,a8,se,st,sa,so,sn,su,sl,iR,sh,sc,sm,sx,eM,sw,sC,sv,sk,s$,sz,sA,sF,sT,sE,sW,sU,sM,sH,sK,sY,im,oo,ou,ol,a3,sQ,sJ,s4,s6,s7,oe,oi,or,os,oh,rN,oc,om,og,s9,oC,ov,tO,oI,{kernelName:d.UnsortedSegmentSum,backendName:"webgpu",kernelFunc:function(e){let{inputs:t,backend:i,attrs:r}=e,{x:a,segmentIds:s}=t,{numSegments:o}=r,n=a.shape.length,u=[],l=0,h=d.backend_util.getAxesPermutation([l],n),p=a;null!=h&&(u.push(p=tW({inputs:{x:a},backend:i,attrs:{perm:h}})),l=d.backend_util.getInnerMostAxes(1,n)[0]);let c=d.backend_util.segment_util.computeOutShape(p.shape,l,o),f=d.util.sizeFromShape([p.shape[l]]),m=eV({inputs:{x:p},backend:i,attrs:{shape:[-1,f]}});u.push(m);let g=a.dtype,x=[m.shape[0],o],y=eO({backend:i,attrs:{shape:x,value:0,dtype:g}}),w=new ok(m.shape,x,g),b=[{type:"int32",data:[o]},{type:"int32",data:[d.util.sizeFromShape(m.shape)]}],C=i.runWebGPUProgram(w,[m,s],g,b,y),S=eV({inputs:{x:C},backend:i,attrs:{shape:c}});u.push(C);let v=S;return null!=h&&(u.push(S),v=tW({inputs:{x:v},backend:i,attrs:{perm:d.backend_util.getUndoAxesPermutation(h)}})),u.forEach(e=>i.disposeData(e.dataId)),v}},a7])(0,d.registerKernel)(e)}};